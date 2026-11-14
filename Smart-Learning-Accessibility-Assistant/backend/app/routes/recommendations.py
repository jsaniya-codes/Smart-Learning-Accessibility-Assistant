"""YouTube educational video recommendation API routes."""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app.services.auth_service import get_current_user
from app.services.gemini_service import GeminiServiceError
from app.services.youtube_service import (
    YouTubeRecommendationError,
    delete_user_video_recommendation,
    generate_youtube_recommendations,
    list_user_video_recommendations,
)

router = APIRouter(prefix="/recommendations", tags=["Recommendations"])


class YoutubeRecommendationRequest(BaseModel):
    content: str = Field(default="")
    customTopic: str = Field(default="", max_length=200)
    keywords: List[str] = Field(default_factory=list)
    learningLevel: str = Field(default="Beginner")
    preferredLanguage: str = Field(default="English", max_length=40)
    sourceType: str = Field(default="text", max_length=32)
    documentId: Optional[str] = Field(default=None, max_length=36)
    conversationId: Optional[str] = Field(default=None, max_length=36)
    forceRefresh: bool = Field(default=False)
    saveToHistory: bool = Field(default=True)


@router.post("/youtube")
async def recommend_youtube_videos_endpoint(
    payload: YoutubeRecommendationRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Extract topic/keywords, query YouTube Data API v3, rank up to 5 educational videos, and persist history."""
    try:
        return generate_youtube_recommendations(
            db=db,
            user_id=current_user.id,
            content=payload.content,
            custom_topic=payload.customTopic,
            keywords=payload.keywords,
            learning_level=payload.learningLevel,
            preferred_language=payload.preferredLanguage,
            source_type=payload.sourceType,
            document_id=payload.documentId,
            conversation_id=payload.conversationId,
            force_refresh=payload.forceRefresh,
            save_to_history=payload.saveToHistory,
        )
    except YouTubeRecommendationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    except GeminiServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch YouTube educational video recommendations.",
        ) from exc


@router.get("/youtube/history")
async def list_youtube_recommendations_endpoint(
    conversationId: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return saved YouTube video recommendation sets for the current user."""
    return {
        "recommendations": list_user_video_recommendations(
            db=db,
            user_id=current_user.id,
            conversation_id=conversationId,
            query=q,
        )
    }


@router.delete("/youtube/{recommendation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_youtube_recommendation_endpoint(
    recommendation_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a saved video recommendation set owned by the current user."""
    deleted = delete_user_video_recommendation(db, current_user.id, recommendation_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Saved video recommendation not found.",
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
