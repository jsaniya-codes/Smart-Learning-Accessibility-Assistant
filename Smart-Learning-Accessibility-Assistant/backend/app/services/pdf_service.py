"""PDF and plain-text extraction service with validation and structure cleanup."""

from io import BytesIO
import re
from typing import Any, Dict, List, Tuple

from pypdf import PdfReader
from pypdf.errors import PdfReadError


class DocumentValidationError(Exception):
    """Raised when an uploaded file fails validation or exceeds size limits."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def normalize_page_text(raw_page_text: str) -> str:
    """
    Clean raw PDF page text while preserving headings, bullet points,
    and paragraph breaks wherever possible.
    """
    if not raw_page_text:
        return ""

    lines = [
        line.rstrip()
        for line in raw_page_text.replace("\r\n", "\n").split("\n")
    ]
    paragraphs: List[str] = []
    buffer: List[str] = []

    def flush_buffer() -> None:
        if buffer:
            paragraphs.append(" ".join(buffer).strip())
            buffer.clear()

    heading_pattern = re.compile(
        r"^(\d+(\.\d+)*\.?\s+[A-Z]|[A-Z][A-Z0-9\s\-:]{3,60}$|Chapter\s+\d+|Section\s+\d+)"
    )
    bullet_pattern = re.compile(r"^\s*([•\-\*]|\d+[\.\)])\s+")

    for line in lines:
        stripped = line.strip()
        if not stripped:
            flush_buffer()
            continue

        if bullet_pattern.match(stripped):
            flush_buffer()
            paragraphs.append(stripped)
            continue

        is_short_heading = (
            len(stripped) <= 70
            and not stripped.endswith((".", ",", ";"))
            and bool(heading_pattern.match(stripped))
        )
        if is_short_heading:
            flush_buffer()
            paragraphs.append(stripped)
            continue

        if buffer and buffer[-1].endswith("-") and not buffer[-1].endswith(" -"):
            buffer[-1] = buffer[-1][:-1] + stripped
        else:
            buffer.append(stripped)

    flush_buffer()
    return "\n\n".join(p for p in paragraphs if p)


def _extract_from_txt(raw_bytes: bytes) -> str:
    """Decode uploaded TXT bytes using UTF-8 with safe fallback encodings."""
    if not raw_bytes:
        raise DocumentValidationError(
            "The uploaded TXT file is empty. Please upload a file with educational text.",
            status_code=422,
        )

    for encoding in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            text = raw_bytes.decode(encoding).strip()
            if not text:
                raise DocumentValidationError(
                    "The uploaded TXT file contains only whitespace. Please add readable text.",
                    status_code=422,
                )
            return re.sub(r"\n{3,}", "\n\n", text.replace("\r\n", "\n"))
        except UnicodeDecodeError:
            continue

    raise DocumentValidationError(
        "Could not decode this TXT file. Please save it using UTF-8 encoding and try again.",
        status_code=422,
    )


def _extract_from_pdf(raw_bytes: bytes) -> Tuple[str, Dict[str, Any]]:
    """Extract readable text from all pages of a PDF and detect scanned pages."""
    if not raw_bytes:
        raise DocumentValidationError(
            "The uploaded PDF file is empty. Please select a valid PDF document.",
            status_code=422,
        )

    try:
        reader = PdfReader(BytesIO(raw_bytes))
    except PdfReadError as exc:
        raise DocumentValidationError(
            f"This file does not appear to be a valid PDF document ({exc}).",
            status_code=422,
        ) from exc
    except Exception as exc:
        raise DocumentValidationError(
            f"Unable to open the uploaded PDF file: {exc}",
            status_code=422,
        ) from exc

    if reader.is_encrypted:
        try:
            decrypt_result = reader.decrypt("")
            if decrypt_result == 0:
                raise DocumentValidationError(
                    "This PDF is password-protected. Please remove the password and upload it again.",
                    status_code=422,
                )
        except DocumentValidationError:
            raise
        except Exception as exc:
            raise DocumentValidationError(
                "This PDF is encrypted and cannot be read without a password.",
                status_code=422,
            ) from exc

    total_pages = len(reader.pages)
    if total_pages == 0:
        raise DocumentValidationError(
            "The uploaded PDF contains zero pages.",
            status_code=422,
        )

    extracted_pages: List[str] = []
    empty_page_count = 0

    for page_idx, page in enumerate(reader.pages, start=1):
        try:
            raw_page_text = page.extract_text() or ""
        except Exception:
            raw_page_text = ""

        normalized = normalize_page_text(raw_page_text)
        if normalized:
            if total_pages > 1:
                extracted_pages.append(f"[Page {page_idx}]\n{normalized}")
            else:
                extracted_pages.append(normalized)
        else:
            empty_page_count += 1

    combined_text = "\n\n".join(extracted_pages).strip()
    if not combined_text:
        raise DocumentValidationError(
            "No extractable text was found in this PDF. It appears to be a scanned or image-only PDF, "
            "so OCR (Optical Character Recognition) is required before text can be processed. "
            "Please run OCR on the PDF or upload a text-based PDF/TXT file.",
            status_code=422,
        )

    pages_with_text = total_pages - empty_page_count
    ocr_warning = None
    if empty_page_count > 0:
        ocr_warning = (
            f"{empty_page_count} of {total_pages} page(s) contained no selectable text "
            f"(likely scanned images or diagrams requiring OCR). Extracted text from the remaining {pages_with_text} page(s)."
        )

    return combined_text, {
        "page_count": total_pages,
        "pages_with_text": pages_with_text,
        "ocr_warning": ocr_warning,
    }


def extract_document_text(
    filename: str,
    raw_bytes: bytes,
    max_upload_bytes: int,
) -> Dict[str, Any]:
    """Validate an uploaded PDF or TXT document and extract clean text plus metadata."""
    clean_name = (filename or "document").strip()
    lower_name = clean_name.lower()

    if not (lower_name.endswith(".pdf") or lower_name.endswith(".txt")):
        raise DocumentValidationError(
            "Unsupported file format. Please upload a .pdf or .txt file.",
            status_code=400,
        )

    if len(raw_bytes) == 0:
        raise DocumentValidationError(
            "The uploaded file is empty. Please choose a file with readable text.",
            status_code=400,
        )

    if len(raw_bytes) > max_upload_bytes:
        max_mb = max_upload_bytes // (1024 * 1024)
        raise DocumentValidationError(
            f"File exceeds the {max_mb} MB upload limit. Please upload a smaller document.",
            status_code=413,
        )

    if lower_name.endswith(".txt"):
        text = _extract_from_txt(raw_bytes)
        words = len(text.split())
        return {
            "filename": clean_name,
            "file_type": "TXT",
            "text": text,
            "page_count": 1,
            "pages_with_text": 1,
            "ocr_warning": None,
            "word_count": words,
            "char_count": len(text),
        }

    text, pdf_info = _extract_from_pdf(raw_bytes)
    words = len(text.split())
    return {
        "filename": clean_name,
        "file_type": "PDF",
        "text": text,
        "page_count": pdf_info["page_count"],
        "pages_with_text": pdf_info["pages_with_text"],
        "ocr_warning": pdf_info["ocr_warning"],
        "word_count": words,
        "char_count": len(text),
    }
