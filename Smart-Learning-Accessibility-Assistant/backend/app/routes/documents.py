"""Document upload, persistent storage, listing, download, and deletion endpoints."""

import re
from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import User
from app.services.auth_service import get_current_user
from app.services.learning_service import (
    compute_reading_metrics,
    delete_user_document,
    get_user_document,
    list_user_documents,
    process_uploaded_document,
    serialize_document_summary,
)
from app.services.pdf_service import DocumentValidationError

router = APIRouter(prefix="/documents", tags=["Documents"])


class AnalyzeTextRequest(BaseModel):
    text: str


def _safe_header_filename(name: str) -> str:
    cleaned = re.sub(r'[^A-Za-z0-9._ -]+', "_", (name or "document")).strip()
    return cleaned or "document"


@router.post("/upload")
async def upload_document(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Upload a PDF or TXT document, enforce size/format limits,
    extract clean text, and store both metadata and file bytes in the database.
    """
    settings = get_settings()
    raw_bytes = await file.read(settings.max_upload_bytes + 1)
    if len(raw_bytes) > settings.max_upload_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds the {settings.max_upload_size_mb} MB upload limit.",
        )

    try:
        return process_uploaded_document(
            filename=file.filename or "document",
            raw_bytes=raw_bytes,
            content_type=file.content_type or "application/octet-stream",
            db=db,
            user_id=current_user.id,
        )
    except DocumentValidationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.get("")
async def list_documents_endpoint(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all documents uploaded by the authenticated user."""
    return {"documents": list_user_documents(db=db, user_id=current_user.id)}


@router.get("/{document_id}")
async def get_document_endpoint(
    document_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Reopen a previously uploaded document with its metadata and extracted text."""
    doc = get_user_document(db=db, user_id=current_user.id, document_id=document_id)
    return serialize_document_summary(doc, include_text=True)


@router.get("/{document_id}/download")
async def download_document_endpoint(
    document_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Download the original uploaded PDF or TXT file bytes from database storage."""
    doc = get_user_document(
        db=db,
        user_id=current_user.id,
        document_id=document_id,
        include_binary=True,
    )
    safe_name = _safe_header_filename(doc.original_filename)
    return Response(
        content=doc.file_content,
        media_type=doc.content_type or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
    )


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document_endpoint(
    document_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete an uploaded document owned by the current user."""
    delete_user_document(db=db, user_id=current_user.id, document_id=document_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/analyze")
async def analyze_text(
    payload: AnalyzeTextRequest,
    _current_user: User = Depends(get_current_user),
):
    """Compute backend reading statistics (word count, characters, estimated reading time)."""
    return compute_reading_metrics(payload.text)
