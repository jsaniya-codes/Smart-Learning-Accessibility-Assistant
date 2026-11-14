"""Voice Tutor orchestration, persistence, signed audio tokens, and section synthesis."""

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import quote

from fastapi import HTTPException, status
import jwt
from jwt import PyJWTError
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Conversation, Document, VoiceTutorAudio, VoiceTutorSession
from app.services.gemini_service import (
    GeminiServiceError,
    generate_voice_tutor_explanation,
    resolve_tutor_language,
)
from app.services.speech_service import SpeechServiceError, generate_speech_mp3


def create_audio_access_token(audio_id: str, user_id: str) -> str:
    """Create a 24h signed token scoped to a single audio clip and user."""
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "audioId": audio_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=24)).timestamp()),
    }
    return jwt.encode(
        payload,
        settings.effective_jwt_secret,
        algorithm=settings.jwt_algorithm,
    )


def verify_audio_access_token(token: str, expected_audio_id: str) -> Optional[str]:
    """Verify an audio URL token and return the owning user_id if valid."""
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.effective_jwt_secret,
            algorithms=[settings.jwt_algorithm],
        )
        if payload.get("audioId") != expected_audio_id:
            return None
        user_id = payload.get("sub")
        return user_id if isinstance(user_id, str) and user_id else None
    except PyJWTError:
        return None


def _build_signed_audio_url(audio_id: str, user_id: str) -> str:
    token = create_audio_access_token(audio_id, user_id)
    return f"/api/voice-tutor/audio/{quote(audio_id)}?token={quote(token)}"


def serialize_voice_tutor_session(
    session: VoiceTutorSession, user_id: str
) -> Dict[str, Any]:
    raw_refs = session.audio_refs_json if isinstance(session.audio_refs_json, list) else []
    audio_refs = []
    for ref in raw_refs:
        if not isinstance(ref, dict) or not ref.get("audioId"):
            continue
        audio_refs.append(
            {
                **ref,
                "audioUrl": _build_signed_audio_url(str(ref["audioId"]), user_id),
            }
        )
    primary = next(
        (r for r in audio_refs if r.get("sectionIndex") == 0),
        audio_refs[0] if audio_refs else None,
    )
    return {
        "id": session.id,
        "documentId": session.document_id,
        "conversationId": session.conversation_id,
        "sourceType": session.source_type,
        "topic": session.topic,
        "lessonTitle": session.lesson_title,
        "sourceExcerpt": session.source_excerpt,
        "learningLevel": session.learning_level,
        "preferredLanguage": session.preferred_language,
        "languageCode": session.language_code,
        "voiceName": session.voice_name,
        "slow": bool(session.slow),
        "explanation": session.explanation_json or {},
        "sections": session.sections_json or [],
        "audioRefs": audio_refs,
        "primaryAudioUrl": primary.get("audioUrl") if primary else None,
        "createdAt": session.created_at.isoformat() if session.created_at else None,
    }


def explain_with_voice_tutor(
    db: Session,
    user_id: str,
    topic: str = "",
    content: str = "",
    source_type: str = "topic",
    document_id: Optional[str] = None,
    conversation_id: Optional[str] = None,
    learning_level: str = "Beginner",
    preferred_language: str = "English",
    voice_name: str = "Kore",
    slow: bool = False,
    generate_initial_audio: bool = True,
) -> Dict[str, Any]:
    effective_topic = (topic or "").strip()
    effective_content = (content or "").strip()
    source_document_name = ""

    if document_id:
        doc = db.execute(
            select(Document).where(Document.id == document_id, Document.user_id == user_id)
        ).scalar_one_or_none()
        if doc is not None:
            source_document_name = doc.original_filename
            if not effective_content and doc.extracted_text:
                effective_content = doc.extracted_text.strip()
            if not effective_topic:
                effective_topic = source_document_name

    if conversation_id:
        conv = db.execute(
            select(Conversation).where(
                Conversation.id == conversation_id, Conversation.user_id == user_id
            )
        ).scalar_one_or_none()
        if conv is not None:
            if not effective_content:
                msg_lines = [
                    f"{'Student Question' if m.role == 'user' else 'Tutor Answer'}: {m.content}"
                    for m in (conv.messages or [])
                ]
                effective_content = "\n\n".join(msg_lines) or (
                    conv.document.extracted_text if conv.document else conv.title
                )
            if not effective_topic:
                effective_topic = conv.title or "Previous Conversation"

    if len(effective_topic) < 2 and len(effective_content) < 10:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please enter a topic, paste study text, or select a document, summary, or conversation.",
        )

    try:
        lesson = generate_voice_tutor_explanation(
            topic=effective_topic,
            content=effective_content,
            source_type=source_type,
            learning_level=learning_level,
            preferred_language=preferred_language,
            source_document_name=source_document_name,
        )
    except GeminiServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

    session = VoiceTutorSession(
        user_id=user_id,
        document_id=document_id if source_document_name else None,
        conversation_id=conversation_id,
        source_type=lesson["sourceType"],
        topic=lesson["topic"][:240],
        lesson_title=lesson["lessonTitle"][:240],
        source_excerpt=(effective_content or effective_topic)[:600],
        learning_level=lesson["learningLevel"],
        preferred_language=lesson["preferredLanguage"],
        language_code=lesson["languageCode"],
        voice_name=voice_name or "Kore",
        slow=bool(slow),
        explanation_json=lesson["explanation"],
        sections_json=lesson["sections"],
        audio_refs_json=[],
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    audio_id: Optional[str] = None
    audio_url: Optional[str] = None
    audio_error: Optional[str] = None
    chunk_count = 0

    sections = lesson["sections"]
    if generate_initial_audio and sections:
        try:
            mp3_bytes, chunk_count, _ = generate_speech_mp3(
                text=sections[0]["spokenScript"],
                lang=lesson["languageCode"],
                slow=bool(slow),
            )
            clip = VoiceTutorAudio(
                user_id=user_id,
                session_id=session.id,
                section_index=0,
                language_code=lesson["languageCode"],
                voice_name=voice_name or "Kore",
                slow=bool(slow),
                mime_type="audio/mpeg",
                audio_bytes=mp3_bytes,
            )
            db.add(clip)
            db.commit()
            db.refresh(clip)

            audio_id = clip.id
            audio_url = _build_signed_audio_url(clip.id, user_id)
            session.audio_refs_json = [
                {
                    "sectionIndex": 0,
                    "audioId": clip.id,
                    "mimeType": "audio/mpeg",
                    "languageCode": lesson["languageCode"],
                    "voiceName": voice_name or "Kore",
                    "slow": bool(slow),
                }
            ]
            db.commit()
            db.refresh(session)
        except SpeechServiceError as exc:
            audio_error = exc.message

    serialized = serialize_voice_tutor_session(session, user_id)
    return {
        "session": serialized,
        "explanation": serialized["explanation"],
        "sections": serialized["sections"],
        "audioId": audio_id,
        "audioUrl": audio_url,
        "sectionIndex": 0,
        "mimeType": "audio/mpeg",
        "chunkCount": chunk_count,
        "audioError": audio_error,
        "metadata": {
            "topic": serialized["topic"],
            "lessonTitle": serialized["lessonTitle"],
            "learningLevel": serialized["learningLevel"],
            "preferredLanguage": serialized["preferredLanguage"],
            "languageCode": serialized["languageCode"],
            "sourceType": serialized["sourceType"],
            "voiceName": serialized["voiceName"],
            "sectionCount": len(serialized["sections"]),
        },
        "cached": bool(lesson.get("cached", False)),
    }


def synthesize_section_audio(
    db: Session,
    user_id: str,
    session_id: Optional[str] = None,
    section_index: int = 0,
    text: str = "",
    preferred_language: str = "English",
    voice_name: str = "Kore",
    slow: bool = False,
) -> Dict[str, Any]:
    session: Optional[VoiceTutorSession] = None
    if session_id:
        session = db.execute(
            select(VoiceTutorSession).where(
                VoiceTutorSession.id == session_id,
                VoiceTutorSession.user_id == user_id,
            )
        ).scalar_one_or_none()
        if session is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Voice Tutor session not found.",
            )

    lang = resolve_tutor_language(
        session.preferred_language if session else preferred_language
    )
    spoken_text = (text or "").strip()
    if not spoken_text and session is not None:
        sections = session.sections_json if isinstance(session.sections_json, list) else []
        matched = next(
            (s for s in sections if isinstance(s, dict) and s.get("index") == section_index),
            None,
        )
        if matched is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Requested lesson section was not found.",
            )
        spoken_text = (matched.get("spokenScript") or "").strip()

    if not spoken_text:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Section text is required to synthesize audio.",
        )

    if session is not None:
        existing = db.execute(
            select(VoiceTutorAudio)
            .where(
                VoiceTutorAudio.user_id == user_id,
                VoiceTutorAudio.session_id == session.id,
                VoiceTutorAudio.section_index == section_index,
                VoiceTutorAudio.language_code == lang["code"],
                VoiceTutorAudio.voice_name == (voice_name or "Kore"),
                VoiceTutorAudio.slow == bool(slow),
            )
            .order_by(VoiceTutorAudio.created_at.desc())
        ).scalar_one_or_none()
        if existing is not None:
            return {
                "audioId": existing.id,
                "audioUrl": _build_signed_audio_url(existing.id, user_id),
                "sectionIndex": section_index,
                "mimeType": existing.mime_type,
                "chunkCount": 1,
                "cached": True,
            }

    try:
        mp3_bytes, chunk_count, _ = generate_speech_mp3(
            text=spoken_text,
            lang=lang["code"],
            slow=bool(slow),
        )
    except SpeechServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

    clip = VoiceTutorAudio(
        user_id=user_id,
        session_id=session.id if session else None,
        section_index=section_index,
        language_code=lang["code"],
        voice_name=voice_name or "Kore",
        slow=bool(slow),
        mime_type="audio/mpeg",
        audio_bytes=mp3_bytes,
    )
    db.add(clip)
    db.commit()
    db.refresh(clip)

    if session is not None:
        refs = list(session.audio_refs_json or [])
        refs = [
            r
            for r in refs
            if not (
                isinstance(r, dict)
                and r.get("sectionIndex") == section_index
                and r.get("languageCode") == lang["code"]
                and r.get("voiceName") == (voice_name or "Kore")
                and bool(r.get("slow")) == bool(slow)
            )
        ]
        refs.append(
            {
                "sectionIndex": section_index,
                "audioId": clip.id,
                "mimeType": "audio/mpeg",
                "languageCode": lang["code"],
                "voiceName": voice_name or "Kore",
                "slow": bool(slow),
            }
        )
        session.audio_refs_json = refs
        db.commit()

    return {
        "audioId": clip.id,
        "audioUrl": _build_signed_audio_url(clip.id, user_id),
        "sectionIndex": section_index,
        "mimeType": "audio/mpeg",
        "chunkCount": chunk_count,
        "cached": False,
    }


def list_voice_tutor_sessions(
    db: Session, user_id: str, query: Optional[str] = None
) -> List[Dict[str, Any]]:
    stmt = (
        select(VoiceTutorSession)
        .where(VoiceTutorSession.user_id == user_id)
        .order_by(VoiceTutorSession.created_at.desc())
    )
    cleaned = (query or "").strip()
    if cleaned:
        pattern = f"%{cleaned}%"
        stmt = stmt.where(
            or_(
                VoiceTutorSession.topic.ilike(pattern),
                VoiceTutorSession.lesson_title.ilike(pattern),
                VoiceTutorSession.source_excerpt.ilike(pattern),
            )
        )
    rows = db.execute(stmt).scalars().all()
    return [serialize_voice_tutor_session(row, user_id) for row in rows]


def delete_voice_tutor_session(db: Session, user_id: str, session_id: str) -> None:
    session = db.execute(
        select(VoiceTutorSession).where(
            VoiceTutorSession.id == session_id,
            VoiceTutorSession.user_id == user_id,
        )
    ).scalar_one_or_none()
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Voice Tutor session not found.",
        )
    db.delete(session)
    db.commit()
