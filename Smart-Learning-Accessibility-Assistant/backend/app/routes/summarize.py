"""Text summarization API routes with JWT authentication and result persistence."""

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app.services.auth_service import get_current_user
from app.services.gemini_service import GeminiServiceError
from app.services.learning_service import run_summarization
from app.services.pdf_service import DocumentValidationError

router = APIRouter(tags=["Summarization"])


class SummarizeRequest(BaseModel):
    text: str = Field(..., min_length=1, description="Educational passage to summarize.")
    summaryLength: Literal["Short", "Medium", "Detailed"] = Field(
        default="Medium",
        description="Desired summary length.",
    )
    documentId: Optional[str] = Field(default=None, max_length=36)
    saveToHistory: bool = Field(default=True)


@router.post("/summarize")
async def summarize_text_endpoint(
    payload: SummarizeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Generate Short, Medium, or Detailed summaries and persist to the user's library."""
    try:
        return run_summarization(
            text=payload.text,
            summary_length=payload.summaryLength,
            db=db,
            user_id=current_user.id,
            document_id=payload.documentId,
            save_to_history=payload.saveToHistory,
        )
    except DocumentValidationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    except GeminiServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
