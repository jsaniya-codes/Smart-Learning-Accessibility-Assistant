"""Persistent conversation and message endpoints scoped to the authenticated user."""

from typing import Optional

from fastapi import APIRouter, Depends, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app.services.auth_service import get_current_user
from app.services.chat_service import (
    add_message_and_reply,
    create_conversation,
    delete_conversation,
    get_conversation_detail,
    list_conversations,
    rename_conversation,
)
from app.services.gemini_service import GeminiServiceError
from app.services.pdf_service import DocumentValidationError
from fastapi import HTTPException

router = APIRouter(prefix="/chats", tags=["Chats"])


class CreateChatRequest(BaseModel):
    title: Optional[str] = Field(default=None, max_length=200)
    documentId: Optional[str] = Field(default=None, max_length=36)


class RenameChatRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)


class CreateMessageRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=10000)
    sourceText: Optional[str] = Field(default=None)
    documentId: Optional[str] = Field(default=None, max_length=36)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_chat_endpoint(
    payload: CreateChatRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a new persistent conversation."""
    return create_conversation(
        db=db,
        user_id=current_user.id,
        title=payload.title,
        document_id=payload.documentId,
    )


@router.get("")
async def list_chats_endpoint(
    q: Optional[str] = Query(default=None, description="Optional search filter"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List the current user's conversations ordered by last updated."""
    return {"conversations": list_conversations(db=db, user_id=current_user.id, query=q)}


@router.get("/{chat_id}")
async def get_chat_endpoint(
    chat_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Fetch a single conversation and all chronological messages."""
    return get_conversation_detail(db=db, user_id=current_user.id, chat_id=chat_id)


@router.post("/{chat_id}/messages", status_code=status.HTTP_201_CREATED)
async def post_chat_message_endpoint(
    chat_id: str,
    payload: CreateMessageRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Save a user message, compute grounded AI reply, and save both to database."""
    try:
        return add_message_and_reply(
            db=db,
            user_id=current_user.id,
            chat_id=chat_id,
            content=payload.content,
            source_text=payload.sourceText,
            document_id=payload.documentId,
        )
    except DocumentValidationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    except GeminiServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.patch("/{chat_id}")
async def rename_chat_endpoint(
    chat_id: str,
    payload: RenameChatRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Rename a conversation owned by the current user."""
    return rename_conversation(
        db=db,
        user_id=current_user.id,
        chat_id=chat_id,
        new_title=payload.title,
    )


@router.delete("/{chat_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_chat_endpoint(
    chat_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a conversation and all associated messages."""
    delete_conversation(db=db, user_id=current_user.id, chat_id=chat_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
