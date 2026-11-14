"""FastAPI routes for the AI Voice Tutor feature."""

import re
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User, VoiceTutorAudio
from app.services.auth_service import decode_access_token, get_current_user
from app.services.gemini_service import SUPPORTED_TUTOR_LANGUAGES
from app.services.voice_tutor_service import (
    delete_voice_tutor_session,
    explain_with_voice_tutor,
    list_voice_tutor_sessions,
    synthesize_section_audio,
    verify_audio_access_token,
)

router = APIRouter(prefix="/voice-tutor", tags=["AI Voice Tutor"])


class VoiceTutorExplainRequest(BaseModel):
    topic: str = Field(default="")
    content: str = Field(default="")
    sourceType: str = Field(default="topic")
    documentId: Optional[str] = None
    conversationId: Optional[str] = None
    learningLevel: str = Field(default="Beginner")
    preferredLanguage: str = Field(default="English")
    voiceName: str = Field(default="Kore")
    slow: bool = Field(default=False)
    generateInitialAudio: bool = Field(default=True)


class VoiceTutorSectionAudioRequest(BaseModel):
    sessionId: Optional[str] = None
    sectionIndex: int = Field(default=0, ge=0)
    text: str = Field(default="")
    preferredLanguage: str = Field(default="English")
    voiceName: str = Field(default="Kore")
    slow: bool = Field(default=False)


@router.get("/languages")
async def get_languages_endpoint():
    return {"languages": SUPPORTED_TUTOR_LANGUAGES}


@router.post("/explain")
async def explain_topic_endpoint(
    payload: VoiceTutorExplainRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return explain_with_voice_tutor(
        db=db,
        user_id=current_user.id,
        topic=payload.topic,
        content=payload.content,
        source_type=payload.sourceType,
        document_id=payload.documentId,
        conversation_id=payload.conversationId,
        learning_level=payload.learningLevel,
        preferred_language=payload.preferredLanguage,
        voice_name=payload.voiceName,
        slow=payload.slow,
        generate_initial_audio=payload.generateInitialAudio,
    )


@router.post("/sections/audio")
async def synthesize_section_audio_endpoint(
    payload: VoiceTutorSectionAudioRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return synthesize_section_audio(
        db=db,
        user_id=current_user.id,
        session_id=payload.sessionId,
        section_index=payload.sectionIndex,
        text=payload.text,
        preferred_language=payload.preferredLanguage,
        voice_name=payload.voiceName,
        slow=payload.slow,
    )


@router.get("/audio/{audio_id}")
async def serve_voice_tutor_audio(
    audio_id: str,
    request: Request,
    token: Optional[str] = Query(default=None),
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    user_id: Optional[str] = None
    if token:
        user_id = verify_audio_access_token(token, audio_id)
    if not user_id and authorization and authorization.startswith("Bearer "):
        user_id = decode_access_token(authorization[7:].strip())
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required to access audio.",
        )

    clip = db.execute(
        select(VoiceTutorAudio).where(
            VoiceTutorAudio.id == audio_id,
            VoiceTutorAudio.user_id == user_id,
        )
    ).scalar_one_or_none()
    if clip is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Audio clip not found.",
        )

    data = clip.audio_bytes
    total_len = len(data)
    mime = clip.mime_type or "audio/mpeg"
    headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=86400",
        "Content-Disposition": f'inline; filename="voice-tutor-{audio_id}.mp3"',
    }

    range_header = request.headers.get("range")
    if range_header:
        match = re.match(r"^bytes=(\d*)-(\d*)$", range_header.strip(), re.IGNORECASE)
        if match:
            start = int(match.group(1)) if match.group(1) else 0
            end = int(match.group(2)) if match.group(2) else total_len - 1
            end = min(end, total_len - 1)
            if start > end or start >= total_len:
                return Response(
                    status_code=416,
                    headers={"Content-Range": f"bytes */{total_len}"},
                )
            chunk = data[start : end + 1]
            return Response(
                content=chunk,
                status_code=206,
                media_type=mime,
                headers={
                    **headers,
                    "Content-Range": f"bytes {start}-{end}/{total_len}",
                    "Content-Length": str(len(chunk)),
                },
            )

    return Response(
        content=data,
        status_code=200,
        media_type=mime,
        headers={**headers, "Content-Length": str(total_len)},
    )


@router.get("/history")
async def list_voice_tutor_history_endpoint(
    q: Optional[str] = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return {"sessions": list_voice_tutor_sessions(db=db, user_id=current_user.id, query=q)}


@router.delete("/{session_id}")
async def delete_voice_tutor_session_endpoint(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    delete_voice_tutor_session(db=db, user_id=current_user.id, session_id=session_id)
    return {"ok": True}
