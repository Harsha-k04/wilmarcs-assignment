from datetime import datetime, timezone
from .extensions import db


def utc_now():
    return datetime.now(timezone.utc)


def iso_utc(value):
    """Serialize stored datetimes as explicit UTC ISO-8601 strings.

    SQLite returns naive datetimes for timezone=True columns; these values were
    written by this application in UTC, so attach UTC before serializing.
    """
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return value.isoformat().replace("+00:00", "Z")


class AnalysisJob(db.Model):
    __tablename__ = "analysis_jobs"
    id = db.Column(db.Integer, primary_key=True)
    channel_url = db.Column(db.String(500), nullable=False)
    status = db.Column(db.String(20), nullable=False, default="pending")
    result_json = db.Column(db.JSON, nullable=True)
    error_message = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=utc_now)
    updated_at = db.Column(db.DateTime(timezone=True), default=utc_now)

    def to_dict(self):
        return {
            "job_id": self.id,
            "channel_url": self.channel_url,
            "status": self.status,
            "result": self.result_json,
            "error": self.error_message,
            "created_at": iso_utc(self.created_at),
            "updated_at": iso_utc(self.updated_at),
        }


class WatchlistChannel(db.Model):
    __tablename__ = "watchlist_channels"
    id = db.Column(db.Integer, primary_key=True)
    channel_url = db.Column(db.String(500), nullable=False, unique=True)
    active = db.Column(db.Boolean, nullable=False, default=True)
    interval_minutes = db.Column(db.Integer, nullable=False, default=1440)
    last_checked_at = db.Column(db.DateTime(timezone=True), nullable=True)
    next_check_at = db.Column(db.DateTime(timezone=True), nullable=True)
    last_video_ids = db.Column(db.JSON, nullable=False, default=list)
    last_metrics = db.Column(db.JSON, nullable=False, default=dict)
    last_scores = db.Column(db.JSON, nullable=False, default=dict)
    last_error = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utc_now)

    def to_dict(self):
        return {
            "id": self.id,
            "channel_url": self.channel_url,
            "active": self.active,
            "interval_minutes": self.interval_minutes,
            "last_checked_at": iso_utc(self.last_checked_at),
            "next_check_at": iso_utc(self.next_check_at),
            "last_error": self.last_error,
            "created_at": iso_utc(self.created_at),
        }


class Alert(db.Model):
    __tablename__ = "watchlist_alerts"
    id = db.Column(db.Integer, primary_key=True)
    watchlist_id = db.Column(db.Integer, db.ForeignKey("watchlist_channels.id", ondelete="CASCADE"), nullable=True, index=True)
    channel_url = db.Column(db.String(500), nullable=False)
    alert_type = db.Column(db.String(40), nullable=False)
    message = db.Column(db.Text, nullable=False)
    payload = db.Column(db.JSON, nullable=False, default=dict)
    is_read = db.Column(db.Boolean, nullable=False, default=False, index=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utc_now, index=True)

    def to_dict(self):
        return {
            "id": self.id,
            "watchlist_id": self.watchlist_id,
            "channel_url": self.channel_url,
            "type": self.alert_type,
            "message": self.message,
            "payload": self.payload or {},
            "is_read": self.is_read,
            "created_at": iso_utc(self.created_at),
        }
