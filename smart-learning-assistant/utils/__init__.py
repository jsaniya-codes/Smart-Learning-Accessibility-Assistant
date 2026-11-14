"""Utility modules for the Smart Learning Accessibility Assistant."""

from .gemini_service import (
    GeminiServiceError,
    answer_learning_question,
    cached_answer_learning_question,
    cached_simplify_educational_text,
    cached_summarize_educational_text,
    get_configured_model,
    simplify_educational_text,
    summarize_educational_text,
)
from .pdf_service import DocumentExtractionError, extract_text_from_upload
from .speech_service import (
    SpeechGenerationError,
    cached_generate_speech_mp3,
    generate_speech_mp3,
    split_text_into_speech_chunks,
)

__all__ = [
    "DocumentExtractionError",
    "GeminiServiceError",
    "SpeechGenerationError",
    "answer_learning_question",
    "cached_answer_learning_question",
    "cached_generate_speech_mp3",
    "cached_simplify_educational_text",
    "cached_summarize_educational_text",
    "extract_text_from_upload",
    "generate_speech_mp3",
    "get_configured_model",
    "simplify_educational_text",
    "split_text_into_speech_chunks",
    "summarize_educational_text",
]
