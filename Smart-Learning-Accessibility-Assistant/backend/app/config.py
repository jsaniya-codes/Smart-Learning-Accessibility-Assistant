"""Application configuration loaded securely from environment variables."""

from functools import lru_cache
from pathlib import Path
import secrets
from typing import List, Optional

from pydantic_settings import BaseSettings, SettingsConfigDict

_EPHEMERAL_DEV_SECRET = secrets.token_urlsafe(48)
_BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    """Central configuration for the Smart Learning FastAPI backend."""

    app_name: str = "Smart Learning Accessibility Assistant API"
    app_version: str = "2.0.0"

    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    youtube_api_key: str = ""

    database_url: str = "sqlite:///./smart_learning.db"

    jwt_secret_key: str = ""
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 1440

    allowed_origins: str = (
        "http://localhost:5173,http://127.0.0.1:5173,"
        "http://localhost:5176,http://127.0.0.1:5176,"
        "http://localhost:3000,http://127.0.0.1:3000"
    )
    allowed_origin_regex: Optional[str] = r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"

    max_upload_size_mb: int = 12
    max_text_length: int = 100000
    max_speech_chars: int = 25000

    model_config = SettingsConfigDict(
        env_file=str(_BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def effective_database_url(self) -> str:
        """Normalize Postgres URLs (e.g. Render postgres://) to SQLAlchemy psycopg driver."""
        url = (self.database_url or "").strip() or "sqlite:///./smart_learning.db"
        if url.startswith("postgres://"):
            return "postgresql+psycopg://" + url[len("postgres://") :]
        if url.startswith("postgresql://") and "+psycopg" not in url:
            return "postgresql+psycopg://" + url[len("postgresql://") :]
        return url

    @property
    def effective_jwt_secret(self) -> str:
        """Return configured JWT secret or an ephemeral dev-only secret."""
        configured = (self.jwt_secret_key or "").strip()
        if configured and configured != "change_this_to_a_long_random_secret_key_in_production":
            return configured
        return _EPHEMERAL_DEV_SECRET

    @property
    def cors_origins_list(self) -> List[str]:
        """Parse comma-separated CORS origins into a clean list."""
        origins = [
            origin.strip().rstrip("/")
            for origin in self.allowed_origins.split(",")
            if origin.strip()
        ]
        return origins or ["http://localhost:5173"]

    @property
    def max_upload_bytes(self) -> int:
        """Maximum allowed upload size in bytes."""
        return max(1, self.max_upload_size_mb) * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings instance."""
    return Settings()
