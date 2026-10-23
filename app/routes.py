import threading
from datetime import datetime, timedelta, timezone

from flask import Blueprint, jsonify, request, current_app
from sqlalchemy.exc import IntegrityError

from .extensions import db
from .models import AnalysisJob, WatchlistChannel, Alert
from .services.analyser import analyse_channel

api = Blueprint("api", __name__)


def _valid_channel_input(value):
    if not isinstance(value, str):
        return False
    value = value.strip()
    lower = value.lower()
    return bool(value) and ("youtube.com" in lower or value.startswith("@") or (value.startswith("UC") and "/" not in value))


def _mark_analysis_timeout(app, job_id):
    """Fail a job whose worker has exceeded the configured wall-clock limit."""
    with app.app_context():
        try:
            job = db.session.get(AnalysisJob, job_id)
            if job is not None and job.status in ("pending", "processing"):
                job.status = "failed"
                job.error_message = (
                    "Analysis exceeded the time limit. This can happen when a "
                    "provider request stalls; please retry."
                )
                job.updated_at = datetime.now(timezone.utc)
                db.session.commit()
                current_app.logger.error("Analysis job %s timed out", job_id)
        except Exception:
            db.session.rollback()
            current_app.logger.exception("Could not mark analysis %s timed out", job_id)
        finally:
            db.session.remove()


def run_analysis(app, job_id):
    with app.app_context():
        try:
            job = db.session.get(AnalysisJob, job_id)
            if job is None:
                return
            job.status = "processing"
            job.updated_at = datetime.now(timezone.utc)
            db.session.commit()
            timeout_seconds = max(30, int(__import__("os").getenv("ANALYSIS_TIMEOUT_SECONDS", "240")))
            watchdog = threading.Timer(timeout_seconds, _mark_analysis_timeout, args=(app, job_id))
            watchdog.daemon = True
            watchdog.start()
            try:
                result = analyse_channel(job.channel_url)
            finally:
                watchdog.cancel()
            db.session.expire_all()
            job = db.session.get(AnalysisJob, job_id)
            # A watchdog may have failed the job while a blocked provider call
            # was still unwinding; never overwrite that terminal state.
            if job is not None and job.status == "processing":
                job.result_json = result
                job.status = "done"
                job.error_message = None
                job.updated_at = datetime.now(timezone.utc)
                db.session.commit()
        except Exception as exc:
            db.session.rollback()
            db.session.expire_all()
            job = db.session.get(AnalysisJob, job_id)
            if job is not None and job.status in ("pending", "processing"):
                job.status = "failed"
                job.error_message = str(exc)[:4000]
                job.updated_at = datetime.now(timezone.utc)
                db.session.commit()
        finally:
            db.session.remove()


@api.get("/health")
def health():
    return jsonify({"status": "ok", "service": "Wilmarcs Video Intelligence"})


@api.post("/analyses")
def create_analysis():
    payload = request.get_json(silent=True) or {}
    channel_url = payload.get("channel_url", "")
    if not isinstance(channel_url, str):
        return jsonify({"error": "channel_url must be a string"}), 400
    channel_url = channel_url.strip()
    if not _valid_channel_input(channel_url):
        return jsonify({"error": "Enter a YouTube URL, channel ID or @handle"}), 400
    job = AnalysisJob(channel_url=channel_url, status="pending")
    db.session.add(job)
    db.session.commit()
    app = current_app._get_current_object()
    threading.Thread(target=run_analysis, args=(app, job.id), daemon=True).start()
    return jsonify({"job_id": job.id, "status": job.status,
                    "status_url": f"/api/analyses/{job.id}",
                    "message": "Analysis job created"}), 202


@api.get("/analyses")
def list_analyses():
    try:
        page = max(1, request.args.get("page", 1, type=int) or 1)
        per_page = min(max(request.args.get("per_page", 10, type=int) or 10, 1), 50)
        query = AnalysisJob.query.order_by(AnalysisJob.created_at.desc(), AnalysisJob.id.desc())
        total = query.count()
        jobs = query.offset((page - 1) * per_page).limit(per_page).all()
        return jsonify({"items": [job.to_dict() for job in jobs],
                        "pagination": {"page": page, "per_page": per_page, "total": total,
                                       "pages": (total + per_page - 1) // per_page}})
    except Exception:
        current_app.logger.exception("Unable to retrieve analysis history")
        return jsonify({"error": "Unable to retrieve analysis history"}), 500


@api.get("/analyses/<int:job_id>")
def get_analysis(job_id):
    job = db.session.get(AnalysisJob, job_id)
    if job is None:
        return jsonify({"error": "Analysis job not found"}), 404
    return jsonify(job.to_dict())


@api.get("/watchlist")
def get_watchlist():
    items = WatchlistChannel.query.order_by(WatchlistChannel.created_at.desc()).all()
    return jsonify({"items": [item.to_dict() for item in items]})


@api.post("/watchlist")
def add_watchlist():
    payload = request.get_json(silent=True) or {}
    channel_url = payload.get("channel_url", "")
    if not _valid_channel_input(channel_url):
        return jsonify({"error": "Enter a valid YouTube channel URL, channel ID or @handle"}), 400
    channel_url = channel_url.strip()
    interval = payload.get("interval_minutes", 1440)
    if isinstance(interval, bool) or not isinstance(interval, int) or not 15 <= interval <= 10080:
        return jsonify({"error": "interval_minutes must be an integer from 15 to 10080"}), 400
    existing = WatchlistChannel.query.filter_by(channel_url=channel_url).first()
    if existing:
        return jsonify({"error": "This channel is already on the watchlist", "item": existing.to_dict()}), 409
    now = datetime.now(timezone.utc)
    item = WatchlistChannel(channel_url=channel_url, interval_minutes=interval,
                            next_check_at=now, last_video_ids=[], last_metrics={}, last_scores={})
    db.session.add(item)
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({"error": "This channel is already on the watchlist"}), 409
    return jsonify({"item": item.to_dict(), "message": "Channel added; first check will establish a baseline."}), 201


@api.patch("/watchlist/<int:watch_id>")
def update_watchlist(watch_id):
    item = db.session.get(WatchlistChannel, watch_id)
    if item is None:
        return jsonify({"error": "Watchlist channel not found"}), 404
    payload = request.get_json(silent=True) or {}
    if "active" in payload:
        if not isinstance(payload["active"], bool):
            return jsonify({"error": "active must be a boolean"}), 400
        item.active = payload["active"]
    if "interval_minutes" in payload:
        interval = payload["interval_minutes"]
        if isinstance(interval, bool) or not isinstance(interval, int) or not 15 <= interval <= 10080:
            return jsonify({"error": "interval_minutes must be an integer from 15 to 10080"}), 400
        item.interval_minutes = interval
        item.next_check_at = datetime.now(timezone.utc) + timedelta(minutes=interval)
    db.session.commit()
    return jsonify({"item": item.to_dict()})


@api.delete("/watchlist/<int:watch_id>")
def remove_watchlist(watch_id):
    item = db.session.get(WatchlistChannel, watch_id)
    if item is None:
        return jsonify({"error": "Watchlist channel not found"}), 404
    Alert.query.filter_by(watchlist_id=watch_id).delete()
    db.session.delete(item)
    db.session.commit()
    return jsonify({"message": "Channel removed from watchlist"})


@api.get("/alerts")
def get_alerts():
    try:
        unread_only = (
            request.args.get("unread_only", "false").lower() == "true"
        )
        limit = min(
            max(request.args.get("limit", 50, type=int) or 50, 1),
            200,
        )

        stmt = db.select(
            Alert.id,
            Alert.watchlist_id,
            Alert.channel_url,
            Alert.alert_type,
            Alert.message,
            Alert.payload,
            Alert.is_read,
            Alert.created_at,
        )

        if unread_only:
            stmt = stmt.where(Alert.is_read.is_(False))

        stmt = stmt.order_by(
            Alert.created_at.desc(),
            Alert.id.desc(),
        ).limit(limit)

        rows = db.session.execute(stmt).mappings().all()

        unread_count = db.session.execute(
            db.select(db.func.count(Alert.id)).where(
                Alert.is_read.is_(False)
            )
        ).scalar_one()

        items = [
            {
                "id": row["id"],
                "watchlist_id": row["watchlist_id"],
                "channel_url": row["channel_url"],
                "type": row["alert_type"],
                "message": row["message"],
                "payload": row["payload"] or {},
                "is_read": row["is_read"],
                "created_at": (
                    row["created_at"].isoformat()
                    if row["created_at"] else None
                ),
            }
            for row in rows
        ]

        return jsonify({
            "items": items,
            "unread_count": unread_count,
        })

    except Exception:
        db.session.rollback()
        current_app.logger.exception("Unable to retrieve alerts")
        return jsonify({"error": "Unable to retrieve alerts"}), 500

@api.post("/alerts/<int:alert_id>/read")
def mark_alert_read(alert_id):
    alert = db.session.get(Alert, alert_id)
    if alert is None:
        return jsonify({"error": "Alert not found"}), 404
    alert.is_read = True
    db.session.commit()
    return jsonify({"item": alert.to_dict()})


@api.post("/watchlist/<int:watch_id>/check")
def trigger_watchlist_check(watch_id):
    item = db.session.get(WatchlistChannel, watch_id)
    if item is None:
        return jsonify({"error": "Watchlist channel not found"}), 404
    from .scheduler import check_watchlist_channel
    app = current_app._get_current_object()
    threading.Thread(target=lambda: _run_check_in_app(app, check_watchlist_channel, watch_id), daemon=True).start()
    return jsonify({"message": "Watchlist check started", "watchlist_id": watch_id}), 202


def _run_check_in_app(app, check_fn, watch_id):
    with app.app_context():
        check_fn(watch_id)
