"""FastAPI application entry point for Smart Learning Accessibility Assistant."""

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import get_settings
from app.database import init_db
from app.routes import (
    assistant,
    auth,
    chats,
    documents,
    history,
    learning_results,
    recommendations,
    simplify,
    speech,
    summarize,
    voice_tutor,
)


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    init_db()
    yield


def create_app() -> FastAPI:
    """Create and configure the FastAPI application instance."""
    settings = get_settings()

    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        lifespan=_lifespan,
        description=(
            "Backend API for Smart Learning Accessibility Assistant. "
            "Handles JWT authentication, persistent PostgreSQL/SQLite history, "
            "PDF/TXT extraction, Google Gemini text simplification, "
            "summarization, grounded student Q&A, and gTTS MP3 audio synthesis."
        ),
    )

    cors_kwargs = {
        "allow_origins": settings.cors_origins_list,
        "allow_credentials": True,
        "allow_methods": ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        "allow_headers": [
            "Content-Type",
            "Authorization",
            "Accept",
            "X-Requested-With",
            "Cache-Control",
        ],
        "expose_headers": [
            "Content-Disposition",
            "X-Speech-Chunks",
            "X-Speech-Truncated",
        ],
    }
    if settings.allowed_origin_regex:
        cors_kwargs["allow_origin_regex"] = settings.allowed_origin_regex

    app.add_middleware(CORSMiddleware, **cors_kwargs)

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(_request: Request, exc: StarletteHTTPException):
        detail = exc.detail if isinstance(exc.detail, (str, list, dict)) else str(exc.detail)
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": detail},
            headers=getattr(exc, "headers", None) or {},
            media_type="application/json",
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(_request: Request, exc: RequestValidationError):
        return JSONResponse(
            status_code=422,
            content={"detail": exc.errors()},
            media_type="application/json",
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(_request: Request, _exc: Exception):
        return JSONResponse(
            status_code=500,
            content={"detail": "An unexpected server error occurred. Please try again."},
            media_type="application/json",
        )

    @app.get("/", tags=["Health"])
    async def root():
        return {
            "service": settings.app_name,
            "version": settings.app_version,
            "docs": "/docs",
        }

    @app.get("/api/health", tags=["Health"])
    async def health_check():
        return {
            "ok": True,
            "model": settings.gemini_model,
            "maxUploadMb": settings.max_upload_size_mb,
        }

    app.include_router(auth.router, prefix="/api")
    app.include_router(chats.router, prefix="/api")
    app.include_router(history.router, prefix="/api")
    app.include_router(learning_results.router, prefix="/api")
    app.include_router(recommendations.router, prefix="/api")
    app.include_router(documents.router, prefix="/api")
    app.include_router(simplify.router, prefix="/api")
    app.include_router(summarize.router, prefix="/api")
    app.include_router(assistant.router, prefix="/api")
    app.include_router(speech.router, prefix="/api")
    app.include_router(voice_tutor.router, prefix="/api")

    @app.api_route(
        "/api/{full_path:path}",
        methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        include_in_schema=False,
    )
    async def api_not_found(full_path: str):
        return JSONResponse(
            status_code=404,
            content={"detail": f"API endpoint '/api/{full_path}' not found."},
            media_type="application/json",
        )

    return app


app = create_app()
