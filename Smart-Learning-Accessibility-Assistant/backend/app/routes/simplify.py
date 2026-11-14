"""Text simplification API routes with JWT authentication and result persistence."""

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app.services.auth_service import get_current_user
from app.services.gemini_service import GeminiServiceError
from app.services.learning_service import run_simplification
from app.services.pdf_service import DocumentValidationError

router = APIRouter(tags=["Simplification"])


class SimplifyRequest(BaseModel):
    text: str = Field(..., min_length=1, description="Educational passage to simplify.")
    readingLevel: Literal["Beginner", "Intermediate", "Advanced"] = Field(
        default="Beginner",
        description="Target explanation level.",
    )
    documentId: Optional[str] = Field(default=None, max_length=36)
    saveToHistory: bool = Field(default=True)


@router.post("/simplify")
async def simplify_text_endpoint(
    payload: SimplifyRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Simplify complex educational content and persist to the user's saved library."""
    try:
        return run_simplification(
            text=payload.text,
            reading_level=payload.readingLevel,
            db=db,
            user_id=current_user.id,
            document_id=payload.documentId,
            save_to_history=payload.saveToHistory,
        )
    except DocumentValidationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    except GeminiServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
