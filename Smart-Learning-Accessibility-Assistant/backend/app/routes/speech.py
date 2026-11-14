"""Text-to-speech MP3 audio generation API routes (protected by JWT)."""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.models import User
from app.services.auth_service import get_current_user
from app.services.learning_service import run_speech_synthesis
from app.services.pdf_service import DocumentValidationError
from app.services.speech_service import SpeechServiceError

router = APIRouter(tags=["Text-to-Speech"])


class SpeechRequest(BaseModel):
    text: str = Field(..., min_length=1, description="Text to convert into spoken MP3 audio.")
    lang: str = Field(default="en", max_length=10, description="Language code (default: en).")
    slow: bool = Field(default=False, description="Speak slowly for clearer comprehension.")


@router.post("/speech")
async def generate_speech_endpoint(
    payload: SpeechRequest,
    _current_user: User = Depends(get_current_user),
):
    """Convert educational text into downloadable MP3 audio."""
    try:
        mp3_bytes, chunk_count, was_truncated = run_speech_synthesis(
            text=payload.text,
            lang=payload.lang,
            slow=payload.slow,
        )
        return Response(
            content=mp3_bytes,
            media_type="audio/mpeg",
            headers={
                "Content-Disposition": 'attachment; filename="smart-learning-audio.mp3"',
                "X-Speech-Chunks": str(chunk_count),
                "X-Speech-Truncated": "true" if was_truncated else "false",
            },
        )
    except DocumentValidationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    except SpeechServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
