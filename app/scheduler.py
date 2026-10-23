"""Single-process background scheduler for watchlist checks.

For production with multiple web workers, run this scheduler as a separate worker
process so the same watchlist is not checked concurrently by every web worker.
"""
import logging
import threading
from datetime import datetime, timedelta, timezone

from .extensions import db
from .models import Alert, AnalysisJob, WatchlistChannel

logger = logging.getLogger(__name__)
_scheduler_lock = threading.Lock()
_scheduler_started = False
_stop_event = threading.Event()


def _utcnow():
    return datetime.now(timezone.utc)


def _create_alert(watch, alert_type, message, payload=None):
    db.session.add(Alert(
        watchlist_id=watch.id,
        channel_url=watch.channel_url,
        alert_type=alert_type,
        message=message,
        payload=payload or {},
    ))


def check_watchlist_channel(watch_id):
    """Run one check and alert only on score changes confirmed twice."""
    from .services.analyser import analyse_channel

    watch = db.session.get(WatchlistChannel, watch_id)
    if not watch or not watch.active:
        return

    now = _utcnow()
    try:
        result = analyse_channel(watch.channel_url)

        # Save each successful scheduled run in Analysis history.
        history_job = AnalysisJob(
            channel_url=watch.channel_url,
            status="done",
            result_json=result,
            updated_at=now,
        )
        db.session.add(history_job)

        videos = result.get("videos", [])
        metrics = result.get("metrics", {}) or {}
        report = result.get("ai_report", {}) or {}
        current_ids = [v.get("video_id") for v in videos if v.get("video_id")]
        current_set = set(current_ids)
        old_ids = set(watch.last_video_ids or [])
        old_metrics = watch.last_metrics or {}
        old_scores = watch.last_scores or {}
        pending_scores = old_metrics.get("__pending_score_changes", {})
        new_ids = current_set - old_ids if old_ids else set()

        # First successful check establishes a baseline instead of alerting for
        # videos already present on the channel.
        if old_ids:
            for video in videos:
                video_id = video.get("video_id")
                if video_id in new_ids:
                    title = video.get("title") or video_id
                    _create_alert(
                        watch, "new_video", f"New video detected: {title}",
                        {"video_id": video_id, "title": title, "views": video.get("views")},
                    )

                    average = metrics.get("average_views")
                    views = video.get("views")
                    if isinstance(average, (int, float)) and average > 0 and isinstance(views, (int, float)):
                        ratio = views / average
                        if ratio >= 1.5:
                            _create_alert(
                                watch, "performance_above_average",
                                f"Early views for '{title}' are {ratio:.1f}x the current channel average.",
                                {"video_id": video_id, "views": views, "average_views": average, "ratio": round(ratio, 2)},
                            )
                        elif ratio <= 0.5:
                            _create_alert(
                                watch, "performance_below_average",
                                f"Early views for '{title}' are {ratio:.1f}x the current channel average; compare again after more time.",
                                {"video_id": video_id, "views": views, "average_views": average, "ratio": round(ratio, 2), "caveat": "Early lifetime views are not age-adjusted."},
                            )

        score_fields = (
            "title_description_score", "cta_score", "posting_consistency_score",
            "hook_strength_score", "storytelling_score",
        )
        current_scores = {
            key: report.get(key)
            for key in score_fields
            if isinstance(report.get(key), (int, float))
        }

        # Confirm a >=2-point change on two consecutive successful checks before
        # alerting. Keep the last confirmed baseline while a change is pending.
        confirmed_changes = {}
        next_pending = {}
        next_scores = dict(old_scores)
        if not old_scores:
            next_scores.update(current_scores)
        else:
            for key, value in current_scores.items():
                baseline = old_scores.get(key)
                if not isinstance(baseline, (int, float)):
                    next_scores[key] = value
                    continue

                if abs(value - baseline) < 2:
                    # The score returned close to baseline: discard any pending change.
                    next_scores[key] = baseline
                    continue

                previous_pending = pending_scores.get(key, {})
                candidate = previous_pending.get("candidate")
                count = previous_pending.get("count", 0)
                if candidate == value:
                    count += 1
                else:
                    candidate = value
                    count = 1

                if count >= 2:
                    confirmed_changes[key] = {"previous": baseline, "current": value}
                    next_scores[key] = value
                else:
                    next_pending[key] = {"candidate": value, "count": count}

        if confirmed_changes:
            _create_alert(
                watch, "score_change",
                "Channel health score change confirmed across consecutive checks.",
                confirmed_changes,
            )

        # Preserve ordinary channel metrics and store pending confirmation data
        # in a reserved internal key to avoid requiring a database migration.
        saved_metrics = dict(metrics)
        saved_metrics["__last_check_status"] = "done"
        saved_metrics["__last_check_finished_at"] = now.isoformat()
        saved_metrics.pop("__last_check_error", None)
        if next_pending:
            saved_metrics["__pending_score_changes"] = next_pending
        watch.last_video_ids = current_ids
        watch.last_metrics = saved_metrics
        watch.last_scores = next_scores
        watch.last_checked_at = now
        watch.next_check_at = now + timedelta(minutes=watch.interval_minutes)
        watch.last_error = None
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        watch = db.session.get(WatchlistChannel, watch_id)
        if watch:
            watch.last_checked_at = now
            watch.next_check_at = now + timedelta(minutes=watch.interval_minutes)
            watch.last_error = str(exc)[:1000]
            try:
                failed_job = AnalysisJob(
                    channel_url=watch.channel_url,
                    status="failed",
                    error_message=str(exc)[:4000],
                    updated_at=now,
                )
                db.session.add(failed_job)
                saved_metrics = dict(watch.last_metrics or {})
                saved_metrics["__last_check_status"] = "failed"
                saved_metrics["__last_check_finished_at"] = now.isoformat()
                saved_metrics["__last_check_error"] = str(exc)[:1000]
                watch.last_metrics = saved_metrics
                db.session.commit()
            except Exception:
                db.session.rollback()
                logger.exception("Could not save failed scheduled analysis to history")
        logger.exception("Watchlist check failed for watchlist id %s", watch_id)
    finally:
        db.session.remove()


def _as_utc_aware(value):
    """Normalize database datetimes before comparing them with UTC now."""
    if value is None:
        return None
    if value.tzinfo is None:
        # SQLite commonly returns naive values for timezone=True columns.
        # Treat these stored timestamps as UTC, matching _utcnow().
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def check_due_watchlist(app):
    with app.app_context():
        now = _utcnow()
        rows = WatchlistChannel.query.filter_by(active=True).all()
        due_ids = [
            row.id for row in rows
            if row.next_check_at is None
            or _as_utc_aware(row.next_check_at) <= now
        ]
        for watch_id in due_ids:
            check_watchlist_channel(watch_id)


def _scheduler_loop(app, poll_seconds):
    while not _stop_event.is_set():
        try:
            check_due_watchlist(app)
        except Exception:
            logger.exception("Watchlist scheduler cycle failed")
        _stop_event.wait(poll_seconds)


def start_scheduler(app, poll_seconds=60):
    """Start one daemon scheduler thread in this process; safe to call twice."""
    global _scheduler_started
    with _scheduler_lock:
        if _scheduler_started:
            return False
        _scheduler_started = True
        thread = threading.Thread(target=_scheduler_loop, args=(app, poll_seconds),
                                  name="watchlist-scheduler", daemon=True)
        thread.start()
        return True
