"""Persistent chat, message, and history search service scoped strictly per user."""

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.models import Conversation, Document, LearningResult, Message
from app.services.learning_service import (
    run_learning_assistant,
    serialize_document_summary,
    serialize_learning_result,
)
from app.services.youtube_service import list_user_video_recommendations
from app.services.voice_tutor_service import list_voice_tutor_sessions


def _derive_chat_title(first_message: str) -> str:
    """Generate a concise, readable conversation title from the first question."""
    cleaned = " ".join((first_message or "").split()).strip()
    if not cleaned:
        return "New Chat"
    if len(cleaned) <= 56:
        return cleaned
    truncated = cleaned[:53].rsplit(" ", 1)[0].strip()
    return f"{truncated or cleaned[:53]}..."


def serialize_message(message: Message) -> Dict[str, Any]:
    """Serialize a Message ORM row into JSON."""
    return {
        "id": message.id,
        "conversationId": message.conversation_id,
        "role": message.role,
        "content": message.content,
        "foundInMaterial": message.found_in_material,
        "examples": message.examples_json or [],
        "supportingQuote": message.supporting_quote or "",
        "createdAt": message.created_at.isoformat() if message.created_at else None,
    }


def serialize_conversation_summary(
    conversation: Conversation,
    message_count: Optional[int] = None,
    last_message_preview: Optional[str] = None,
) -> Dict[str, Any]:
    """Serialize a Conversation summary row."""
    doc_name = conversation.document.original_filename if conversation.document else None
    return {
        "id": conversation.id,
        "title": conversation.title,
        "documentId": conversation.document_id,
        "documentName": doc_name,
        "messageCount": (
            message_count
            if message_count is not None
            else len(conversation.messages or [])
        ),
        "lastMessagePreview": last_message_preview,
        "createdAt": (
            conversation.created_at.isoformat() if conversation.created_at else None
        ),
        "updatedAt": (
            conversation.updated_at.isoformat() if conversation.updated_at else None
        ),
    }


def _get_owned_conversation(
    db: Session, user_id: str, chat_id: str, with_messages: bool = False
) -> Conversation:
    stmt = select(Conversation).where(
        Conversation.id == chat_id,
        Conversation.user_id == user_id,
    )
    if with_messages:
        stmt = stmt.options(
            selectinload(Conversation.messages),
            selectinload(Conversation.document),
        )
    else:
        stmt = stmt.options(selectinload(Conversation.document))

    conversation = db.execute(stmt).scalar_one_or_none()
    if conversation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found.",
        )
    return conversation


def _get_owned_document(db: Session, user_id: str, document_id: str) -> Document:
    doc = db.execute(
        select(Document).where(
            Document.id == document_id,
            Document.user_id == user_id,
        )
    ).scalar_one_or_none()
    if doc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Referenced document not found.",
        )
    return doc


def list_conversations(
    db: Session, user_id: str, query: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Return user's conversations ordered by most recently updated."""
    stmt = (
        select(Conversation)
        .options(
            selectinload(Conversation.document),
            selectinload(Conversation.messages),
        )
        .where(Conversation.user_id == user_id)
        .order_by(Conversation.updated_at.desc())
    )

    cleaned_query = (query or "").strip()
    if cleaned_query:
        pattern = f"%{cleaned_query}%"
        matching_chat_ids = (
            select(Message.conversation_id)
            .join(Conversation, Message.conversation_id == Conversation.id)
            .where(
                Conversation.user_id == user_id,
                Message.content.ilike(pattern),
            )
        )
        stmt = stmt.where(
            or_(
                Conversation.title.ilike(pattern),
                Conversation.id.in_(matching_chat_ids),
            )
        )

    rows = db.execute(stmt).scalars().all()
    results = []
    for conv in rows:
        msgs = conv.messages or []
        last_preview = msgs[-1].content[:120] if msgs else None
        results.append(
            serialize_conversation_summary(
                conv,
                message_count=len(msgs),
                last_message_preview=last_preview,
            )
        )
    return results


def create_conversation(
    db: Session,
    user_id: str,
    title: Optional[str] = None,
    document_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Create a new persistent conversation owned by the current user."""
    if document_id:
        _get_owned_document(db, user_id, document_id)

    cleaned_title = " ".join((title or "").split()).strip() or "New Chat"
    conversation = Conversation(
        user_id=user_id,
        document_id=document_id,
        title=cleaned_title[:200],
    )
    db.add(conversation)
    db.commit()
    db.refresh(conversation)

    loaded = _get_owned_conversation(db, user_id, conversation.id, with_messages=True)
    return {
        **serialize_conversation_summary(loaded, message_count=0),
        "messages": [],
    }


def get_conversation_detail(
    db: Session, user_id: str, chat_id: str
) -> Dict[str, Any]:
    """Load an owned conversation along with its chronological messages."""
    conversation = _get_owned_conversation(db, user_id, chat_id, with_messages=True)
    doc_payload = (
        serialize_document_summary(conversation.document, include_text=True)
        if conversation.document
        else None
    )
    return {
        **serialize_conversation_summary(
            conversation,
            message_count=len(conversation.messages),
        ),
        "document": doc_payload,
        "messages": [serialize_message(msg) for msg in conversation.messages],
        "recommendations": list_user_video_recommendations(
            db, user_id, conversation_id=chat_id
        ),
    }


def rename_conversation(
    db: Session, user_id: str, chat_id: str, new_title: str
) -> Dict[str, Any]:
    """Update a conversation title owned by the current user."""
    cleaned = " ".join((new_title or "").split()).strip()
    if not cleaned:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Conversation title cannot be empty.",
        )

    conversation = _get_owned_conversation(db, user_id, chat_id, with_messages=True)
    conversation.title = cleaned[:200]
    conversation.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(conversation)
    return serialize_conversation_summary(
        conversation, message_count=len(conversation.messages)
    )


def delete_conversation(db: Session, user_id: str, chat_id: str) -> None:
    """Delete a conversation and cascade-delete all of its messages."""
    conversation = _get_owned_conversation(db, user_id, chat_id)
    db.delete(conversation)
    db.commit()


def add_message_and_reply(
    db: Session,
    user_id: str,
    chat_id: str,
    content: str,
    source_text: Optional[str] = None,
    document_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Persist user question, run grounded Gemini assistant, and persist AI response."""
    conversation = _get_owned_conversation(db, user_id, chat_id, with_messages=True)

    trimmed_question = (content or "").strip()
    if len(trimmed_question) < 3:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please enter a clear question (at least 3 characters).",
        )

    attached_doc: Optional[Document] = conversation.document
    if document_id:
        attached_doc = _get_owned_document(db, user_id, document_id)
        conversation.document_id = attached_doc.id

    study_text = (source_text or "").strip()
    if len(study_text) < 15 and attached_doc is not None:
        study_text = attached_doc.extracted_text

    if len(study_text) < 15:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please enter educational text or attach a saved document before asking a question.",
        )

    ai_result = run_learning_assistant(text=study_text, question=trimmed_question)

    now = datetime.now(timezone.utc)
    assistant_time = now + timedelta(milliseconds=1)

    user_message = Message(
        conversation_id=conversation.id,
        role="user",
        content=trimmed_question,
        created_at=now,
    )
    assistant_message = Message(
        conversation_id=conversation.id,
        role="assistant",
        content=ai_result.get("answer", ""),
        found_in_material=bool(ai_result.get("foundInMaterial", False)),
        examples_json=ai_result.get("examples") or [],
        supporting_quote=ai_result.get("supportingQuote") or "",
        created_at=assistant_time,
    )

    if not conversation.messages and conversation.title in ("New Chat", "Untitled Chat", ""):
        conversation.title = _derive_chat_title(trimmed_question)
    conversation.updated_at = assistant_time

    db.add(user_message)
    db.add(assistant_message)
    db.commit()
    db.refresh(user_message)
    db.refresh(assistant_message)
    db.refresh(conversation)

    total_messages = db.execute(
        select(func.count(Message.id)).where(Message.conversation_id == conversation.id)
    ).scalar_one()

    return {
        "conversation": serialize_conversation_summary(
            conversation,
            message_count=int(total_messages),
            last_message_preview=assistant_message.content[:120],
        ),
        "userMessage": serialize_message(user_message),
        "assistantMessage": serialize_message(assistant_message),
    }


def get_user_history_overview(db: Session, user_id: str) -> Dict[str, Any]:
    """Return a unified overview of user conversations, documents, and saved results."""
    conversations = list_conversations(db, user_id)

    docs = (
        db.execute(
            select(Document)
            .where(Document.user_id == user_id)
            .order_by(Document.created_at.desc())
        )
        .scalars()
        .all()
    )
    results = (
        db.execute(
            select(LearningResult)
            .where(LearningResult.user_id == user_id)
            .order_by(LearningResult.created_at.desc())
        )
        .scalars()
        .all()
    )

    return {
        "conversations": conversations,
        "documents": [serialize_document_summary(doc, include_text=False) for doc in docs],
        "learningResults": [serialize_learning_result(item) for item in results],
        "videoRecommendations": list_user_video_recommendations(db, user_id),
        "voiceTutorSessions": list_voice_tutor_sessions(db, user_id),
    }


def search_user_history(db: Session, user_id: str, query: str) -> Dict[str, Any]:
    """Search user's conversations, messages, documents, and saved learning results."""
    cleaned = (query or "").strip()
    if not cleaned:
        return get_user_history_overview(db, user_id)

    pattern = f"%{cleaned}%"
    conversations = list_conversations(db, user_id, query=cleaned)

    docs = (
        db.execute(
            select(Document)
            .where(
                Document.user_id == user_id,
                or_(
                    Document.original_filename.ilike(pattern),
                    Document.extracted_text.ilike(pattern),
                ),
            )
            .order_by(Document.created_at.desc())
        )
        .scalars()
        .all()
    )

    results = (
        db.execute(
            select(LearningResult)
            .where(
                LearningResult.user_id == user_id,
                or_(
                    LearningResult.title.ilike(pattern),
                    LearningResult.content_text.ilike(pattern),
                    LearningResult.source_excerpt.ilike(pattern),
                ),
            )
            .order_by(LearningResult.created_at.desc())
        )
        .scalars()
        .all()
    )

    return {
        "query": cleaned,
        "conversations": conversations,
        "documents": [serialize_document_summary(doc, include_text=False) for doc in docs],
        "learningResults": [serialize_learning_result(item) for item in results],
        "videoRecommendations": list_user_video_recommendations(
            db, user_id, query=cleaned
        ),
        "voiceTutorSessions": list_voice_tutor_sessions(db, user_id, query=cleaned),
    }
