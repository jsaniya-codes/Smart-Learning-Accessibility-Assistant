"""SQLAlchemy ORM models for users, persistent chats, documents, and learning results."""

from datetime import datetime, timezone
import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    LargeBinary,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _new_uuid() -> str:
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_uuid)
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str] = mapped_column(
        String(255), unique=True, index=True, nullable=False
    )
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )

    conversations: Mapped[list["Conversation"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        order_by="desc(Conversation.updated_at)",
    )
    documents: Mapped[list["Document"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        order_by="desc(Document.created_at)",
    )
    learning_results: Mapped[list["LearningResult"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        order_by="desc(LearningResult.created_at)",
    )
    video_recommendations: Mapped[list["VideoRecommendation"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        order_by="desc(VideoRecommendation.created_at)",
    )
    voice_tutor_sessions: Mapped[list["VoiceTutorSession"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        order_by="desc(VoiceTutorSession.created_at)",
    )


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_type: Mapped[str] = mapped_column(String(20), nullable=False)
    file_size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    content_type: Mapped[str] = mapped_column(
        String(100), nullable=False, default="application/octet-stream"
    )
    processing_status: Mapped[str] = mapped_column(
        String(32), nullable=False, default="completed"
    )
    page_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    pages_with_text: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    ocr_warning: Mapped[str | None] = mapped_column(Text, nullable=True)
    word_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    char_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    estimated_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    extracted_text: Mapped[str] = mapped_column(Text, nullable=False)
    file_content: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True, nullable=False
    )

    user: Mapped["User"] = relationship(back_populates="documents")
    conversations: Mapped[list["Conversation"]] = relationship(
        back_populates="document"
    )
    learning_results: Mapped[list["LearningResult"]] = relationship(
        back_populates="document"
    )
    video_recommendations: Mapped[list["VideoRecommendation"]] = relationship(
        back_populates="document"
    )
    voice_tutor_sessions: Mapped[list["VoiceTutorSession"]] = relationship(
        back_populates="document"
    )


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    document_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("documents.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False, default="New Chat")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=_utcnow,
        onupdate=_utcnow,
        index=True,
        nullable=False,
    )

    user: Mapped["User"] = relationship(back_populates="conversations")
    document: Mapped["Document | None"] = relationship(back_populates="conversations")
    messages: Mapped[list["Message"]] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="asc(Message.created_at)",
    )
    video_recommendations: Mapped[list["VideoRecommendation"]] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="desc(VideoRecommendation.created_at)",
    )
    voice_tutor_sessions: Mapped[list["VoiceTutorSession"]] = relationship(
        back_populates="conversation"
    )


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (
        CheckConstraint("role IN ('user', 'assistant')", name="ck_messages_role"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_uuid)
    conversation_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("conversations.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    found_in_material: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    examples_json: Mapped[list | None] = mapped_column(JSON, nullable=True)
    supporting_quote: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True, nullable=False
    )

    conversation: Mapped["Conversation"] = relationship(back_populates="messages")


class LearningResult(Base):
    __tablename__ = "learning_results"
    __table_args__ = (
        CheckConstraint(
            "result_type IN ('simplified', 'summary', 'explanation')",
            name="ck_learning_results_type",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    document_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("documents.id", ondelete="SET NULL"), nullable=True
    )
    result_type: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    source_excerpt: Mapped[str] = mapped_column(Text, nullable=False)
    reading_level: Mapped[str | None] = mapped_column(String(32), nullable=True)
    summary_length: Mapped[str | None] = mapped_column(String(32), nullable=True)
    content_text: Mapped[str] = mapped_column(Text, nullable=False)
    keywords_json: Mapped[list | None] = mapped_column(JSON, nullable=True)
    bullet_points_json: Mapped[list | None] = mapped_column(JSON, nullable=True)
    concepts_json: Mapped[list | None] = mapped_column(JSON, nullable=True)
    examples_json: Mapped[list | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True, nullable=False
    )

    user: Mapped["User"] = relationship(back_populates="learning_results")
    document: Mapped["Document | None"] = relationship(
        back_populates="learning_results"
    )


class VideoRecommendation(Base):
    __tablename__ = "video_recommendations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    conversation_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("conversations.id", ondelete="CASCADE"), index=True, nullable=True
    )
    document_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("documents.id", ondelete="SET NULL"), nullable=True
    )
    source_type: Mapped[str] = mapped_column(String(32), nullable=False, default="text")
    topic: Mapped[str] = mapped_column(String(240), nullable=False)
    search_query: Mapped[str] = mapped_column(String(300), nullable=False)
    learning_level: Mapped[str] = mapped_column(String(32), nullable=False, default="Beginner")
    preferred_language: Mapped[str] = mapped_column(String(40), nullable=False, default="English")
    keywords_json: Mapped[list | None] = mapped_column(JSON, nullable=True)
    videos_json: Mapped[list | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True, nullable=False
    )

    user: Mapped["User"] = relationship(back_populates="video_recommendations")
    conversation: Mapped["Conversation | None"] = relationship(
        back_populates="video_recommendations"
    )
    document: Mapped["Document | None"] = relationship(
        back_populates="video_recommendations"
    )


class VoiceTutorSession(Base):
    __tablename__ = "voice_tutor_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    document_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("documents.id", ondelete="SET NULL"), nullable=True
    )
    conversation_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True
    )
    source_type: Mapped[str] = mapped_column(String(32), nullable=False, default="topic")
    topic: Mapped[str] = mapped_column(String(240), nullable=False)
    lesson_title: Mapped[str] = mapped_column(String(240), nullable=False)
    source_excerpt: Mapped[str] = mapped_column(Text, nullable=False, default="")
    learning_level: Mapped[str] = mapped_column(String(32), nullable=False, default="Beginner")
    preferred_language: Mapped[str] = mapped_column(String(40), nullable=False, default="English")
    language_code: Mapped[str] = mapped_column(String(16), nullable=False, default="en")
    voice_name: Mapped[str] = mapped_column(String(40), nullable=False, default="Kore")
    slow: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    explanation_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    sections_json: Mapped[list] = mapped_column(JSON, nullable=False)
    audio_refs_json: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True, nullable=False
    )

    user: Mapped["User"] = relationship(back_populates="voice_tutor_sessions")
    document: Mapped["Document | None"] = relationship(back_populates="voice_tutor_sessions")
    conversation: Mapped["Conversation | None"] = relationship(
        back_populates="voice_tutor_sessions"
    )
    audio_clips: Mapped[list["VoiceTutorAudio"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
    )


class VoiceTutorAudio(Base):
    __tablename__ = "voice_tutor_audio"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    session_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("voice_tutor_sessions.id", ondelete="CASCADE"), index=True, nullable=True
    )
    section_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    language_code: Mapped[str] = mapped_column(String(16), nullable=False, default="en")
    voice_name: Mapped[str] = mapped_column(String(40), nullable=False, default="Kore")
    slow: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    mime_type: Mapped[str] = mapped_column(String(64), nullable=False, default="audio/mpeg")
    audio_bytes: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    session: Mapped["VoiceTutorSession | None"] = relationship(back_populates="audio_clips")

