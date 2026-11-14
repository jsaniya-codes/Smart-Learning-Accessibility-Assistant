"""Grounded AI Learning Assistant Q&A API routes (protected by JWT)."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.models import User
from app.services.auth_service import get_current_user
from app.services.gemini_service import GeminiServiceError
from app.services.learning_service import run_learning_assistant
from app.services.pdf_service import DocumentValidationError

router = APIRouter(tags=["AI Learning Assistant"])


class AssistantQuestionRequest(BaseModel):
    text: str = Field(..., min_length=1, description="Uploaded or entered study material.")
    question: str = Field(..., min_length=1, description="Student question about the material.")


@router.post("/assistant")
async def assistant_question_endpoint(
    payload: AssistantQuestionRequest,
    _current_user: User = Depends(get_current_user),
):
    """Answer student questions strictly grounded in the provided study material."""
    try:
        return run_learning_assistant(
            text=payload.text,
            question=payload.question,
        )
    except DocumentValidationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    except GeminiServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
