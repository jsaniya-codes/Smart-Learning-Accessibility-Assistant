"""Text-to-speech service using gTTS with sentence-aligned chunking and LRU caching."""

from collections import OrderedDict
from io import BytesIO
import re
from typing import List, Tuple

from gtts import gTTS
from gtts.tts import gTTSError


class SpeechServiceError(Exception):
    """Raised when text-to-speech conversion fails or input is invalid."""

    def __init__(self, message: str, status_code: int = 500) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


CHUNK_CHAR_LIMIT = 1800
MAX_AUDIO_CACHE_ITEMS = 24
_AUDIO_CACHE: OrderedDict[Tuple[str, str, bool], Tuple[bytes, int, bool]] = OrderedDict()


def split_text_into_speech_chunks(
    text: str, chunk_limit: int = CHUNK_CHAR_LIMIT
) -> List[str]:
    """
    Split long educational text cleanly along sentence boundaries so gTTS
    can synthesize lengthy passages reliably without errors.
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
            words = sentence.split(" ")
            for word in words:
                if len(word) > chunk_limit:
                    if current:
                        chunks.append(current)
                        current = ""
                    for i in range(0, len(word), chunk_limit):
                        chunks.append(word[i : i + chunk_limit])
                    continue
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
    text: str,
    lang: str = "en",
    slow: bool = False,
    max_total_chars: int = 25000,
) -> Tuple[bytes, int, bool]:
    """
    Convert educational text into downloadable MP3 bytes using gTTS.
    Returns (mp3_bytes, chunk_count, was_truncated).
    """
    cleaned_text = (text or "").strip()
    if not cleaned_text:
        raise SpeechServiceError(
            "Please provide educational text before generating audio.",
            status_code=400,
        )

    normalized_lang = (lang or "en").strip().lower() or "en"
    was_truncated = False

    if len(cleaned_text) > max_total_chars:
        was_truncated = True
        sliced = cleaned_text[:max_total_chars]
        if " " in sliced:
            sliced = sliced.rsplit(" ", 1)[0]
        cleaned_text = f"{sliced.strip()}..."

    cache_key = (cleaned_text, normalized_lang, bool(slow))
    if cache_key in _AUDIO_CACHE:
        _AUDIO_CACHE.move_to_end(cache_key)
        return _AUDIO_CACHE[cache_key]

    chunks = split_text_into_speech_chunks(cleaned_text)
    if not chunks:
        raise SpeechServiceError("No speakable text was found.", status_code=400)

    combined_buffer = BytesIO()
    try:
        for chunk in chunks:
            tts = gTTS(text=chunk, lang=normalized_lang, slow=bool(slow))
            tts.write_to_fp(combined_buffer)

        combined_buffer.seek(0)
        audio_bytes = combined_buffer.getvalue()
        if not audio_bytes:
            raise SpeechServiceError("Generated audio output was empty.", status_code=500)

        result = (audio_bytes, len(chunks), was_truncated)
        _AUDIO_CACHE[cache_key] = result
        if len(_AUDIO_CACHE) > MAX_AUDIO_CACHE_ITEMS:
            _AUDIO_CACHE.popitem(last=False)
        return result
    except SpeechServiceError:
        raise
    except gTTSError as exc:
        raise SpeechServiceError(
            f"Text-to-speech service error. Please verify internet connectivity and try again ({exc}).",
            status_code=502,
        ) from exc
    except Exception as exc:
        raise SpeechServiceError(
            f"Unexpected error while generating MP3 audio: {exc}",
            status_code=500,
        ) from exc
