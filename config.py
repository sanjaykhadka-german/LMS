import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-change-me")

    db_url = os.environ.get("DATABASE_URL", "sqlite:///lms.db")
    if db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql://", 1)
    SQLALCHEMY_DATABASE_URI = db_url
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), "static", "uploads")
    MAX_CONTENT_LENGTH = 100 * 1024 * 1024
    ALLOWED_EXTENSIONS = {
        "pdf", "txt", "md",
        "mp3", "wav", "m4a", "ogg",
        "mp4", "mov", "webm",
        "png", "jpg", "jpeg",
    }

    RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
    MAIL_FROM = os.environ.get("MAIL_FROM", "training@example.com")
    MAIL_FROM_NAME = os.environ.get("MAIL_FROM_NAME", "Training")
    APP_BASE_URL = os.environ.get("APP_BASE_URL", "http://localhost:5000")
    ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "")
    PASS_THRESHOLD = int(os.environ.get("PASS_THRESHOLD", "80"))
