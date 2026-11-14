"""Saved learning results endpoints (simplified outputs, summaries, explanations)."""

from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app.services.auth_service import get_current_user
from app.services.learning_service import (
    delete_learning_result,
    list_learning_results,
    save_learning_result,
)

router = APIRouter(prefix="/learning-results", tags=["Learning Results"])


class SaveLearningResultRequest(BaseModel):
    resultType: Literal["simplified", "summary", "explanation"]
    title: Optional[str] = Field(default=None, max_length=200)
    sourceExcerpt: str = Field(..., min_length=1)
    contentText: str = Field(..., min_length=1)
    documentId: Optional[str] = Field(default=None, max_length=36)
    readingLevel: Optional[str] = Field(default=None, max_length=32)
    summaryLength: Optional[str] = Field(default=None, max_length=32)
    keywords: List[str] = Field(default_factory=list)
    bulletPoints: List[str] = Field(default_factory=list)
    concepts: List[Dict[str, Any]] = Field(default_factory=list)
    examples: List[str] = Field(default_factory=list)


@router.get("")
async def list_learning_results_endpoint(
    result_type: Optional[Literal["simplified", "summary", "explanation"]] = Query(
        default=None, alias="type"
    ),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List saved simplified outputs, summaries, and explanations for the current user."""
    return {
        "results": list_learning_results(
            db=db,
            user_id=current_user.id,
            result_type=result_type,
        )
    }


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_learning_result_endpoint(
    payload: SaveLearningResultRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Save a learning result explicitly into the user's persistent library."""
    return save_learning_result(
        db=db,
        user_id=current_user.id,
        result_type=payload.resultType,
        content_text=payload.contentText,
        source_excerpt=payload.sourceExcerpt,
        title=payload.title,
        document_id=payload.documentId,
        reading_level=payload.readingLevel,
        summary_length=payload.summaryLength,
        keywords=payload.keywords,
        bullet_points=payload.bulletPoints,
        concepts=payload.concepts,
        examples=payload.examples,
    )


@router.delete("/{result_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_learning_result_endpoint(
    result_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a saved learning result owned by the current user."""
    delete_learning_result(db=db, user_id=current_user.id, result_id=result_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
