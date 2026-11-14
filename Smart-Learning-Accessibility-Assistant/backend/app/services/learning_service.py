"""Orchestration and business logic layer coordinating document, AI, speech, and DB persistence."""

import math
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Document, LearningResult
from app.services.gemini_service import (
    answer_learning_question,
    simplify_educational_text,
    summarize_educational_text,
)
from app.services.pdf_service import DocumentValidationError, extract_document_text
from app.services.speech_service import generate_speech_mp3


def compute_reading_metrics(text: str) -> Dict[str, int]:
    """Calculate backend reading metrics for educational content."""
    trimmed = (text or "").strip()
    if not trimmed:
        return {"wordCount": 0, "charCount": 0, "estimatedMinutes": 0}

    words = len(trimmed.split())
    chars = len(trimmed)
    estimated_minutes = max(1, math.ceil(words / 180))
    return {
        "wordCount": words,
        "charCount": chars,
        "estimatedMinutes": estimated_minutes,
    }


def validate_text_bounds(text: str) -> str:
    """Ensure pasted or extracted text respects backend length boundaries."""
    settings = get_settings()
    cleaned = (text or "").strip()
    if len(cleaned) < 15:
        raise DocumentValidationError(
            "Please enter educational text or upload a PDF/TXT document first (15+ characters).",
            status_code=400,
        )
    if len(cleaned) > settings.max_text_length:
        raise DocumentValidationError(
            f"Text exceeds the maximum supported limit of {settings.max_text_length:,} characters.",
            status_code=413,
        )
    return cleaned


def serialize_document_summary(
    doc: Document, include_text: bool = False
) -> Dict[str, Any]:
    """Serialize a persistent Document row for API responses."""
    payload: Dict[str, Any] = {
        "id": doc.id,
        "filename": doc.original_filename,
        "originalFilename": doc.original_filename,
        "fileType": doc.file_type,
        "fileSizeBytes": doc.file_size_bytes,
        "contentType": doc.content_type,
        "processingStatus": doc.processing_status,
        "pageCount": doc.page_count,
        "pagesWithText": doc.pages_with_text,
        "ocrWarning": doc.ocr_warning,
        "wordCount": doc.word_count,
        "charCount": doc.char_count,
        "estimatedMinutes": doc.estimated_minutes,
        "createdAt": doc.created_at.isoformat() if doc.created_at else None,
    }
    if include_text:
        payload["text"] = doc.extracted_text
    return payload


def serialize_learning_result(item: LearningResult) -> Dict[str, Any]:
    """Serialize a saved LearningResult ORM row."""
    return {
        "id": item.id,
        "documentId": item.document_id,
        "resultType": item.result_type,
        "title": item.title,
        "sourceExcerpt": item.source_excerpt,
        "readingLevel": item.reading_level,
        "summaryLength": item.summary_length,
        "contentText": item.content_text,
        "keywords": item.keywords_json or [],
        "bulletPoints": item.bullet_points_json or [],
        "concepts": item.concepts_json or [],
        "examples": item.examples_json or [],
        "createdAt": item.created_at.isoformat() if item.created_at else None,
    }


def _derive_result_title(prefix: str, source_text: str, custom_title: Optional[str] = None) -> str:
    if custom_title and custom_title.strip():
        return " ".join(custom_title.split()).strip()[:200]
    snippet = " ".join((source_text or "").split()).strip()
    if not snippet:
        return prefix
    if len(snippet) > 48:
        snippet = snippet[:45].rsplit(" ", 1)[0].strip() + "..."
    return f"{prefix}: {snippet}"[:200]


def process_uploaded_document(
    filename: str,
    raw_bytes: bytes,
    content_type: str = "application/octet-stream",
    db: Optional[Session] = None,
    user_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Validate, extract text, and optionally persist the document + binary bytes in DB."""
    settings = get_settings()
    extracted = extract_document_text(
        filename=filename,
        raw_bytes=raw_bytes,
        max_upload_bytes=settings.max_upload_bytes,
    )
    metrics = compute_reading_metrics(extracted["text"])

    if db is not None and user_id is not None:
        inferred_ct = content_type or (
            "application/pdf" if extracted["file_type"] == "PDF" else "text/plain"
        )
        doc = Document(
            user_id=user_id,
            original_filename=extracted["filename"],
            file_type=extracted["file_type"],
            file_size_bytes=len(raw_bytes),
            content_type=inferred_ct[:100],
            processing_status="completed",
            page_count=extracted["page_count"],
            pages_with_text=extracted["pages_with_text"],
            ocr_warning=extracted["ocr_warning"],
            word_count=metrics["wordCount"],
            char_count=metrics["charCount"],
            estimated_minutes=metrics["estimatedMinutes"],
            extracted_text=extracted["text"],
            file_content=raw_bytes,
        )
        db.add(doc)
        db.commit()
        db.refresh(doc)
        return serialize_document_summary(doc, include_text=True)

    return {
        "filename": extracted["filename"],
        "fileType": extracted["file_type"],
        "text": extracted["text"],
        "pageCount": extracted["page_count"],
        "pagesWithText": extracted["pages_with_text"],
        "ocrWarning": extracted["ocr_warning"],
        "wordCount": metrics["wordCount"],
        "charCount": metrics["charCount"],
        "estimatedMinutes": metrics["estimatedMinutes"],
    }


def list_user_documents(db: Session, user_id: str) -> List[Dict[str, Any]]:
    """List documents uploaded by the authenticated user."""
    docs = (
        db.execute(
            select(Document)
            .where(Document.user_id == user_id)
            .order_by(Document.created_at.desc())
        )
        .scalars()
        .all()
    )
    return [serialize_document_summary(doc, include_text=False) for doc in docs]


def get_user_document(
    db: Session, user_id: str, document_id: str, include_binary: bool = False
) -> Document:
    """Fetch a single document ensuring ownership by user_id."""
    doc = db.execute(
        select(Document).where(
            Document.id == document_id,
            Document.user_id == user_id,
        )
    ).scalar_one_or_none()
    if doc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found.",
        )
    if include_binary and not doc.file_content:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Stored file content is unavailable for this document.",
        )
    return doc


def delete_user_document(db: Session, user_id: str, document_id: str) -> None:
    """Delete a document owned by the current user."""
    doc = get_user_document(db, user_id, document_id)
    db.delete(doc)
    db.commit()


def save_learning_result(
    db: Session,
    user_id: str,
    result_type: str,
    content_text: str,
    source_excerpt: str,
    title: Optional[str] = None,
    document_id: Optional[str] = None,
    reading_level: Optional[str] = None,
    summary_length: Optional[str] = None,
    keywords: Optional[List[str]] = None,
    bullet_points: Optional[List[str]] = None,
    concepts: Optional[List[Dict[str, Any]]] = None,
    examples: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Persist a simplified passage, summary, or explanation for the user."""
    if document_id:
        get_user_document(db, user_id, document_id)

    label_map = {
        "simplified": f"Simplified ({reading_level or 'Beginner'})",
        "summary": f"Summary ({summary_length or 'Medium'})",
        "explanation": "Explanation",
    }
    computed_title = _derive_result_title(
        label_map.get(result_type, "Learning Result"),
        source_excerpt,
        custom_title=title,
    )
    excerpt = " ".join((source_excerpt or "").split()).strip()[:500] or "Study passage"

    record = LearningResult(
        user_id=user_id,
        document_id=document_id,
        result_type=result_type,
        title=computed_title,
        source_excerpt=excerpt,
        reading_level=reading_level,
        summary_length=summary_length,
        content_text=content_text,
        keywords_json=keywords or [],
        bullet_points_json=bullet_points or [],
        concepts_json=concepts or [],
        examples_json=examples or [],
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return serialize_learning_result(record)


def list_learning_results(
    db: Session, user_id: str, result_type: Optional[str] = None
) -> List[Dict[str, Any]]:
    """List saved learning results owned by the user."""
    stmt = select(LearningResult).where(LearningResult.user_id == user_id)
    if result_type:
        stmt = stmt.where(LearningResult.result_type == result_type)
    stmt = stmt.order_by(LearningResult.created_at.desc())
    rows = db.execute(stmt).scalars().all()
    return [serialize_learning_result(item) for item in rows]


def delete_learning_result(db: Session, user_id: str, result_id: str) -> None:
    """Delete a saved learning result owned by the user."""
    item = db.execute(
        select(LearningResult).where(
            LearningResult.id == result_id,
            LearningResult.user_id == user_id,
        )
    ).scalar_one_or_none()
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Learning result not found.",
        )
    db.delete(item)
    db.commit()


def run_simplification(
    text: str,
    reading_level: str,
    db: Optional[Session] = None,
    user_id: Optional[str] = None,
    document_id: Optional[str] = None,
    save_to_history: bool = True,
) -> Dict[str, Any]:
    """Validate text, invoke backend Gemini simplification, and optionally persist result."""
    cleaned = validate_text_bounds(text)
    result = simplify_educational_text(text=cleaned, reading_level=reading_level)

    if save_to_history and db is not None and user_id is not None:
        saved = save_learning_result(
            db=db,
            user_id=user_id,
            result_type="simplified",
            content_text=result.get("simplifiedText", ""),
            source_excerpt=cleaned,
            document_id=document_id,
            reading_level=reading_level,
            concepts=result.get("difficultConcepts") or [],
            examples=result.get("examples") or [],
        )
        result["savedResultId"] = saved["id"]

    return result


def run_summarization(
    text: str,
    summary_length: str,
    db: Optional[Session] = None,
    user_id: Optional[str] = None,
    document_id: Optional[str] = None,
    save_to_history: bool = True,
) -> Dict[str, Any]:
    """Validate text, invoke backend Gemini summarization, and optionally persist result."""
    cleaned = validate_text_bounds(text)
    result = summarize_educational_text(text=cleaned, summary_length=summary_length)

    if save_to_history and db is not None and user_id is not None:
        saved = save_learning_result(
            db=db,
            user_id=user_id,
            result_type="summary",
            content_text=result.get("summaryText", ""),
            source_excerpt=cleaned,
            document_id=document_id,
            summary_length=summary_length,
            keywords=result.get("keywords") or [],
            bullet_points=result.get("bulletPoints") or [],
            concepts=result.get("keyConcepts") or [],
        )
        result["savedResultId"] = saved["id"]

    return result


def run_learning_assistant(text: str, question: str) -> Dict[str, Any]:
    """Validate text/question and invoke grounded Gemini Q&A."""
    cleaned = validate_text_bounds(text)
    return answer_learning_question(source_text=cleaned, question=question)


def run_speech_synthesis(
    text: str, lang: str = "en", slow: bool = False
) -> Tuple[bytes, int, bool]:
    """Validate text and generate downloadable MP3 speech audio."""
    settings = get_settings()
    cleaned = (text or "").strip()
    if not cleaned:
        raise DocumentValidationError(
            "Please enter or load educational text before generating audio.",
            status_code=400,
        )
    return generate_speech_mp3(
        text=cleaned,
        lang=lang,
        slow=slow,
        max_total_chars=settings.max_speech_chars,
    )
