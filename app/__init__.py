import os
from flask import Flask
from flask_cors import CORS
from .extensions import db
from .routes import api


def create_app():
    app = Flask(__name__)
    database_url = os.getenv("DATABASE_URL", "sqlite:///wilmarcs.db")
    if database_url.startswith("postgres://"):
        database_url = database_url.replace("postgres://", "postgresql://", 1)
    app.config["SQLALCHEMY_DATABASE_URI"] = database_url
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    db.init_app(app)
    allowed_origins = [origin.strip() for origin in os.getenv(
        "CORS_ORIGINS", "http://localhost:5173"
    ).split(",") if origin.strip()]
    CORS(app, resources={r"/api/*": {"origins": allowed_origins}})
    app.register_blueprint(api, url_prefix="/api")
    with app.app_context():
        db.create_all()
    if os.getenv("ENABLE_WATCHLIST_SCHEDULER", "true").lower() == "true":
        # In Flask's debug reloader, only the child process should run the scheduler.
        is_reloader_parent = os.getenv("FLASK_DEBUG", "false").lower() == "true" and os.getenv("WERKZEUG_RUN_MAIN") != "true"
        if not is_reloader_parent:
            from .scheduler import start_scheduler
            start_scheduler(app, poll_seconds=max(15, int(os.getenv("WATCHLIST_POLL_SECONDS", "60"))))
    return app
