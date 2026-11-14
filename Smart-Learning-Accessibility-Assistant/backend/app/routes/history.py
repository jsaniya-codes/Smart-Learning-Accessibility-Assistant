"""Unified user learning history and search endpoints."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app.services.auth_service import get_current_user
from app.services.chat_service import get_user_history_overview, search_user_history

router = APIRouter(prefix="/history", tags=["History"])


@router.get("")
async def get_history_endpoint(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return user's conversations, uploaded documents, and saved learning results."""
    return get_user_history_overview(db=db, user_id=current_user.id)


@router.get("/search")
async def search_history_endpoint(
    q: str = Query(default="", description="Search term across chats, docs, and results"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Search across the user's persistent learning history."""
    return search_user_history(db=db, user_id=current_user.id, query=q)
