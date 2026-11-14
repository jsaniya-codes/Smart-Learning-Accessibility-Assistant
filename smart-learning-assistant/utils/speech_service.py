"""Text-to-speech conversion utilities using gTTS with long-text chunking and caching."""

from io import BytesIO
import re
from typing import List

from gtts import gTTS
from gtts.tts import gTTSError
import streamlit as st


class SpeechGenerationError(Exception):
    """Raised when text-to-speech conversion fails."""


CHUNK_CHAR_LIMIT = 1800
MAX_TOTAL_SPEECH_CHARS = 25000


def split_text_into_speech_chunks(
    text: str, chunk_limit: int = CHUNK_CHAR_LIMIT
) -> List[str]:
    """
    Split long educational text cleanly along sentence boundaries so gTTS
    can synthesize lengthy passages reliably without crashing.
    """
    cleaned = re.sub(r"\s+", " ", (text or "")).strip()
    if not cleaned:
        return []

    if len(cleaned) <= chunk_limit:
        return [cleaned]

    sentences = re.split(r"(?<=[.!?])\s+", cleaned)
    chunks: List[str] = []
    current = ""

    for sentence in sentences:
        if len(sentence) > chunk_limit:
            # Split overly long sentences by words
            words = sentence.split(" ")
            for word in words:
                candidate = f"{current} {word}".strip() if current else word
                if len(candidate) <= chunk_limit:
                    current = candidate
                else:
                    if current:
                        chunks.append(current)
                    current = word
            continue

        candidate = f"{current} {sentence}".strip() if current else sentence
        if len(candidate) <= chunk_limit:
            current = candidate
        else:
            if current:
                chunks.append(current)
            current = sentence

    if current:
        chunks.append(current)

    return chunks


def generate_speech_mp3(
    text: str, lang: str = "en", slow: bool = False
) -> bytes:
    """
    Convert educational text into MP3 audio bytes using gTTS.
    Supports long text by synthesizing sentence-aligned chunks and combining MP3 streams.
    """
    cleaned_text = (text or "").strip()
    if not cleaned_text:
        raise SpeechGenerationError(
            "Please provide or load some text before generating speech."
        )

    if len(cleaned_text) > MAX_TOTAL_SPEECH_CHARS:
        cleaned_text = (
            cleaned_text[:MAX_TOTAL_SPEECH_CHARS].rsplit(" ", 1)[0] + "..."
        )

    chunks = split_text_into_speech_chunks(cleaned_text)
    if not chunks:
        raise SpeechGenerationError("No speakable text was found.")

    combined_buffer = BytesIO()
    try:
        for chunk in chunks:
            tts = gTTS(text=chunk, lang=lang, slow=slow)
            tts.write_to_fp(combined_buffer)

        combined_buffer.seek(0)
        audio_bytes = combined_buffer.getvalue()
        if not audio_bytes:
            raise SpeechGenerationError("Generated audio output was empty.")
        return audio_bytes
    except gTTSError as exc:
        raise SpeechGenerationError(
            f"Text-to-speech service error. Please check your internet connection and try again ({exc})."
        ) from exc
    except Exception as exc:
        raise SpeechGenerationError(
            f"Unexpected error while generating MP3 audio: {exc}"
        ) from exc


@st.cache_data(show_spinner=False, ttl=3600)
def cached_generate_speech_mp3(
    text: str, lang: str = "en", slow: bool = False
) -> bytes:
    """Cached wrapper to avoid regenerating identical MP3 audio."""
    return generate_speech_mp3(text=text, lang=lang, slow=slow)
