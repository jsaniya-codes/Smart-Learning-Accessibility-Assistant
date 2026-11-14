"""PDF and plain-text document extraction utilities with structure preservation."""

from io import BytesIO
import re
from typing import Dict, List, Tuple

from pypdf import PdfReader
from pypdf.errors import PdfReadError


class DocumentExtractionError(Exception):
    """Raised when an uploaded file cannot be read or contains no usable text."""


def _normalize_page_text(raw_page_text: str) -> str:
    """
    Clean raw PDF page text while preserving headings, bullet points,
    and paragraph breaks wherever possible.
    """
    if not raw_page_text:
        return ""

    lines = [line.rstrip() for line in raw_page_text.replace("\r\n", "\n").split("\n")]
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

        # Rejoin hyphenated words split across line wraps
        if buffer and buffer[-1].endswith("-") and not buffer[-1].endswith(" -"):
            buffer[-1] = buffer[-1][:-1] + stripped
        else:
            buffer.append(stripped)

    flush_buffer()
    return "\n\n".join(p for p in paragraphs if p)


def _extract_from_txt(raw_bytes: bytes) -> str:
    """Decode uploaded TXT bytes using UTF-8 with fallback encodings."""
    if not raw_bytes:
        raise DocumentExtractionError(
            "The uploaded TXT file is empty. Please upload a file with educational text."
        )

    for encoding in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            text = raw_bytes.decode(encoding).strip()
            if not text:
                raise DocumentExtractionError(
                    "The uploaded TXT file contains only whitespace. Please add readable text."
                )
            return re.sub(r"\n{3,}", "\n\n", text.replace("\r\n", "\n"))
        except UnicodeDecodeError:
            continue

    raise DocumentExtractionError(
        "Could not decode this TXT file. Please save it using UTF-8 encoding and try again."
    )


def _extract_from_pdf(raw_bytes: bytes) -> Tuple[str, Dict]:
    """
    Extract readable text from all pages of a PDF file while preserving
    paragraph and heading structure and detecting scanned pages.
    """
    if not raw_bytes:
        raise DocumentExtractionError(
            "The uploaded PDF file is empty. Please select a valid PDF document."
        )

    try:
        reader = PdfReader(BytesIO(raw_bytes))
    except PdfReadError as exc:
        raise DocumentExtractionError(
            f"This file does not appear to be a valid PDF document ({exc})."
        ) from exc
    except Exception as exc:
        raise DocumentExtractionError(
            f"Unable to open the uploaded PDF file: {exc}"
        ) from exc

    if reader.is_encrypted:
        try:
            decrypt_result = reader.decrypt("")
            if decrypt_result == 0:
                raise DocumentExtractionError(
                    "This PDF is password-protected. Please remove the password and upload it again."
                )
        except DocumentExtractionError:
            raise
        except Exception as exc:
            raise DocumentExtractionError(
                "This PDF is encrypted and cannot be read without a password."
            ) from exc

    total_pages = len(reader.pages)
    if total_pages == 0:
        raise DocumentExtractionError("The uploaded PDF contains zero pages.")

    extracted_pages: List[str] = []
    empty_page_count = 0

    for page_idx, page in enumerate(reader.pages, start=1):
        try:
            raw_page_text = page.extract_text() or ""
        except Exception:
            raw_page_text = ""

        normalized = _normalize_page_text(raw_page_text)
        if normalized:
            if total_pages > 1:
                extracted_pages.append(f"[Page {page_idx}]\n{normalized}")
            else:
                extracted_pages.append(normalized)
        else:
            empty_page_count += 1

    combined_text = "\n\n".join(extracted_pages).strip()
    if not combined_text:
        raise DocumentExtractionError(
            "No extractable text was found in this PDF. It appears to be a scanned or image-only PDF, "
            "so OCR (Optical Character Recognition) is required before text can be processed. "
            "Please run OCR on the PDF or upload a text-based PDF/TXT file."
        )

    ocr_warning = None
    if empty_page_count > 0:
        ocr_warning = (
            f"{empty_page_count} of {total_pages} page(s) contained no selectable text "
            "(likely scanned images or diagrams requiring OCR). Extracted text from the remaining pages."
        )

    return combined_text, {
        "pages": total_pages,
        "pages_with_text": total_pages - empty_page_count,
        "ocr_warning": ocr_warning,
    }


def extract_text_from_upload(uploaded_file) -> Tuple[str, Dict]:
    """
    Extract text from a Streamlit UploadedFile (.pdf or .txt).

    Returns:
        Tuple of (extracted_text, metadata_dict)
    """
    if uploaded_file is None:
        raise DocumentExtractionError("No file was provided.")

    filename = getattr(uploaded_file, "name", "document").strip()
    lower_name = filename.lower()
    raw_bytes = uploaded_file.getvalue()

    if lower_name.endswith(".txt"):
        text = _extract_from_txt(raw_bytes)
        return text, {
            "filename": filename,
            "file_type": "TXT",
            "pages": 1,
            "pages_with_text": 1,
            "ocr_warning": None,
        }

    if lower_name.endswith(".pdf"):
        text, pdf_info = _extract_from_pdf(raw_bytes)
        return text, {
            "filename": filename,
            "file_type": "PDF",
            **pdf_info,
        }

    raise DocumentExtractionError(
        "Unsupported file format. Please upload a .pdf or .txt file."
    )
