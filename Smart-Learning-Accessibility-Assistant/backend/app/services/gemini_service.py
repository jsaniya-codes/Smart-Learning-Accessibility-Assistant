"""Google Gemini API service for text simplification, summarization, and grounded Q&A."""

from collections import OrderedDict
import hashlib
import json
import time
from typing import Any, Dict, List, Optional

from google import genai
from google.genai import errors as genai_errors
from google.genai import types

from app.config import get_settings

MAX_SINGLE_CALL_CHARS = 28000
CHUNK_SIZE_CHARS = 12000
MAX_CACHE_ENTRIES = 60


class GeminiServiceError(Exception):
    """Raised when Gemini API configuration or generation fails."""

    def __init__(self, message: str, status_code: int = 500) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


_RESPONSE_CACHE: OrderedDict[str, Dict[str, Any]] = OrderedDict()


def _make_cache_key(namespace: str, *parts: str) -> str:
    digest = hashlib.sha256("::".join([namespace, *parts]).encode("utf-8")).hexdigest()
    return f"{namespace}:{digest}"


def _get_cached(key: str) -> Optional[Dict[str, Any]]:
    if key not in _RESPONSE_CACHE:
        return None
    _RESPONSE_CACHE.move_to_end(key)
    return _RESPONSE_CACHE[key]


def _set_cached(key: str, value: Dict[str, Any]) -> None:
    if key in _RESPONSE_CACHE:
        _RESPONSE_CACHE.move_to_end(key)
    elif len(_RESPONSE_CACHE) >= MAX_CACHE_ENTRIES:
        _RESPONSE_CACHE.popitem(last=False)
    _RESPONSE_CACHE[key] = value


def _get_client() -> genai.Client:
    settings = get_settings()
    api_key = (settings.gemini_api_key or "").strip()
    if not api_key or api_key == "your_gemini_api_key_here":
        raise GeminiServiceError(
            "GEMINI_API_KEY is not configured on the backend server. "
            "Please set GEMINI_API_KEY in backend/.env or your hosting environment variables.",
            status_code=500,
        )
    return genai.Client(api_key=api_key)


def _get_model() -> str:
    import re

    settings = get_settings()
    raw = (settings.gemini_model or "").strip()
    if raw.lower().startswith("models/"):
        raw = raw[7:]
    if not raw or not re.match(r"^gemini-[a-z0-9._-]+$", raw, re.IGNORECASE):
        return "gemini-2.5-flash"
    return raw


def _parse_json_response(raw_text: Optional[str]) -> Dict[str, Any]:
    if not raw_text or not raw_text.strip():
        raise GeminiServiceError(
            "Gemini returned an empty response. Please try again.",
            status_code=502,
        )

    cleaned = raw_text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.startswith("json"):
            cleaned = cleaned[4:]
        cleaned = cleaned.strip()

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise GeminiServiceError(
            "Could not parse the structured response from Gemini. Please try again.",
            status_code=502,
        ) from exc


def _generate_with_retry(
    client: genai.Client,
    model: str,
    contents: str,
    config: types.GenerateContentConfig,
    retries: int = 2,
) -> str:
    last_exc: Optional[Exception] = None
    for attempt in range(retries + 1):
        try:
            response = client.models.generate_content(
                model=model,
                contents=contents,
                config=config,
            )
            return response.text or ""
        except genai_errors.APIError as exc:
            last_exc = exc
            code = getattr(exc, "code", None)
            if code in (429, 503) and attempt < retries:
                time.sleep(1.2 * (attempt + 1))
                continue
            if code in (401, 403):
                raise GeminiServiceError(
                    "Gemini API authentication failed. Please verify GEMINI_API_KEY on the server.",
                    status_code=403,
                ) from exc
            if code == 429:
                raise GeminiServiceError(
                    "Gemini API rate limit reached. Please wait a moment and try again.",
                    status_code=429,
                ) from exc
            raise GeminiServiceError(
                f"Gemini API error: {exc.message}",
                status_code=502,
            ) from exc
        except Exception as exc:
            last_exc = exc
            if attempt < retries:
                time.sleep(0.8 * (attempt + 1))
                continue
            raise GeminiServiceError(
                f"Unexpected error communicating with Gemini API: {exc}",
                status_code=502,
            ) from exc

    raise GeminiServiceError(f"Gemini request failed: {last_exc}", status_code=502)


def _split_long_text(text: str, max_chunk_chars: int = CHUNK_SIZE_CHARS) -> List[str]:
    if len(text) <= max_chunk_chars:
        return [text]

    paragraphs = text.split("\n\n")
    chunks: List[str] = []
    current = ""

    for para in paragraphs:
        candidate = f"{current}\n\n{para}".strip() if current else para
        if len(candidate) <= max_chunk_chars:
            current = candidate
        else:
            if current:
                chunks.append(current)
            if len(para) > max_chunk_chars:
                chunks.append(para[:max_chunk_chars])
                current = ""
            else:
                current = para

    if current:
        chunks.append(current)
    return chunks


def _condense_long_document(client: genai.Client, model: str, text: str) -> str:
    if len(text) <= MAX_SINGLE_CALL_CHARS:
        return text

    chunks = _split_long_text(text, CHUNK_SIZE_CHARS)[:6]
    notes: List[str] = []
    for idx, chunk in enumerate(chunks, start=1):
        extracted = _generate_with_retry(
            client=client,
            model=model,
            contents=(
                f"Extract all factual key points, definitions, and claims from Section {idx} below. "
                "Include ONLY information explicitly present in the text:\n\n"
                f"{chunk}"
            ),
            config=types.GenerateContentConfig(
                systemInstruction="Extract faithful, grounded study notes strictly from the provided section without adding outside facts."
            ),
        ).strip()
        if extracted:
            notes.append(f"[Section {idx}]\n{extracted}")

    return "\n\n".join(notes) or text[:MAX_SINGLE_CALL_CHARS]


def simplify_educational_text(
    text: str, reading_level: str = "Beginner"
) -> Dict[str, Any]:
    """Simplify complex educational content for Beginner, Intermediate, or Advanced readers."""
    cleaned = (text or "").strip()
    if len(cleaned) < 15:
        raise GeminiServiceError(
            "Please provide at least a short educational sentence (15+ characters) to simplify.",
            status_code=400,
        )

    normalized_level = (
        reading_level
        if reading_level in ("Beginner", "Intermediate", "Advanced")
        else "Beginner"
    )
    cache_key = _make_cache_key("simplify", normalized_level, cleaned)
    cached = _get_cached(cache_key)
    if cached is not None:
        return {**cached, "cached": True}

    level_guidance = {
        "Beginner": (
            "Target level: BEGINNER (plain everyday English). "
            "Use short sentences, familiar words, and clear everyday analogies so any student new to the topic can understand effortlessly."
        ),
        "Intermediate": (
            "Target level: INTERMEDIATE (high-school / early undergraduate level). "
            "Use clear everyday English while retaining standard academic vocabulary where useful, "
            "unpacking abstract sentences and providing concrete examples."
        ),
        "Advanced": (
            "Target level: ADVANCED (clarity-focused academic revision). "
            "Preserve full technical nuance and precision while untangling overly dense sentence structures "
            "and illustrating complex mechanisms with sharp examples."
        ),
    }

    client = _get_client()
    model = _get_model()
    effective_text = _condense_long_document(client, model, cleaned)

    schema = types.Schema(
        type=types.Type.OBJECT,
        properties={
            "simplifiedText": types.Schema(
                type=types.Type.STRING,
                description="Rewritten passage tailored to the requested explanation level.",
            ),
            "difficultConcepts": types.Schema(
                type=types.Type.ARRAY,
                description="Technical terms explained in plain language.",
                items=types.Schema(
                    type=types.Type.OBJECT,
                    properties={
                        "term": types.Schema(type=types.Type.STRING),
                        "explanation": types.Schema(type=types.Type.STRING),
                    },
                    required=["term", "explanation"],
                ),
            ),
            "examples": types.Schema(
                type=types.Type.ARRAY,
                description="Helpful real-world examples illustrating the ideas.",
                items=types.Schema(type=types.Type.STRING),
            ),
        },
        required=["simplifiedText", "difficultConcepts", "examples"],
    )

    raw = _generate_with_retry(
        client=client,
        model=model,
        contents=(
            f"{level_guidance[normalized_level]}\n\n"
            "Simplify the following educational content while preserving 100% of its core meaning and important details:\n\n"
            f"{effective_text}"
        ),
        config=types.GenerateContentConfig(
            systemInstruction=(
                "You are an empathetic educational accessibility assistant. "
                "Rewrite complex academic or technical passages cleanly according to the requested explanation level "
                "while preserving 100% of the original meaning and accuracy. "
                "Explain difficult technical terms clearly and give relatable real-world examples."
            ),
            responseMimeType="application/json",
            responseSchema=schema,
        ),
    )

    parsed = _parse_json_response(raw)
    payload = {
        "simplifiedText": parsed.get("simplifiedText", ""),
        "difficultConcepts": parsed.get("difficultConcepts", [])
        if isinstance(parsed.get("difficultConcepts"), list)
        else [],
        "examples": parsed.get("examples", [])
        if isinstance(parsed.get("examples"), list)
        else [],
        "readingLevel": normalized_level,
    }
    _set_cached(cache_key, payload)
    return {**payload, "cached": False}


def summarize_educational_text(
    text: str, summary_length: str = "Medium"
) -> Dict[str, Any]:
    """Generate Short, Medium, or Detailed summaries with keywords, bullet points, and definitions."""
    cleaned = (text or "").strip()
    if len(cleaned) < 15:
        raise GeminiServiceError(
            "Please provide at least a short educational sentence (15+ characters) to summarize.",
            status_code=400,
        )

    normalized_length = (
        summary_length
        if summary_length in ("Short", "Medium", "Detailed")
        else "Medium"
    )
    cache_key = _make_cache_key("summarize", normalized_length, cleaned)
    cached = _get_cached(cache_key)
    if cached is not None:
        return {**cached, "cached": True}

    length_guidance = {
        "Short": (
            "Length: SHORT (a crisp 2 to 4 sentence overview capturing the central thesis), "
            "plus 3 to 4 concise bullet points and 2 to 4 key concepts."
        ),
        "Medium": (
            "Length: MEDIUM (1 to 2 balanced paragraphs covering the core message and key supporting ideas), "
            "plus 4 to 6 clear bullet points and 3 to 5 key concepts."
        ),
        "Detailed": (
            "Length: DETAILED (3 to 4 thorough paragraphs covering main arguments, supporting mechanisms, and relationships), "
            "plus 6 to 8 comprehensive bullet points and 4 to 6 key concepts."
        ),
    }

    client = _get_client()
    model = _get_model()
    source_for_summary = _condense_long_document(client, model, cleaned)

    schema = types.Schema(
        type=types.Type.OBJECT,
        properties={
            "summaryText": types.Schema(
                type=types.Type.STRING,
                description="Overview summary calibrated to the requested length.",
            ),
            "keywords": types.Schema(
                type=types.Type.ARRAY,
                description="5 to 10 essential keywords explicitly present in the source text.",
                items=types.Schema(type=types.Type.STRING),
            ),
            "bulletPoints": types.Schema(
                type=types.Type.ARRAY,
                description="Important study takeaways as concise bullet points.",
                items=types.Schema(type=types.Type.STRING),
            ),
            "keyConcepts": types.Schema(
                type=types.Type.ARRAY,
                description="Important concepts and definitions supported by the text.",
                items=types.Schema(
                    type=types.Type.OBJECT,
                    properties={
                        "term": types.Schema(type=types.Type.STRING),
                        "definition": types.Schema(type=types.Type.STRING),
                    },
                    required=["term", "definition"],
                ),
            ),
        },
        required=["summaryText", "keywords", "bulletPoints", "keyConcepts"],
    )

    raw = _generate_with_retry(
        client=client,
        model=model,
        contents=(
            f"{length_guidance[normalized_length]}\n\n"
            "Strictly summarize ONLY what is supported by the source material below. "
            "Do NOT introduce external facts or unsupported claims:\n\n"
            f"{source_for_summary}"
        ),
        config=types.GenerateContentConfig(
            systemInstruction=(
                "You are an accurate educational study-skills assistant. "
                "Produce faithful summaries calibrated to the requested length (Short, Medium, or Detailed). "
                "Extract high-value keywords, bullet-point takeaways, and key definitions strictly supported by the source text."
            ),
            responseMimeType="application/json",
            responseSchema=schema,
        ),
    )

    parsed = _parse_json_response(raw)
    payload = {
        "summaryText": parsed.get("summaryText", ""),
        "keywords": parsed.get("keywords", [])
        if isinstance(parsed.get("keywords"), list)
        else [],
        "bulletPoints": parsed.get("bulletPoints", [])
        if isinstance(parsed.get("bulletPoints"), list)
        else [],
        "keyConcepts": parsed.get("keyConcepts", [])
        if isinstance(parsed.get("keyConcepts"), list)
        else [],
        "summaryLength": normalized_length,
    }
    _set_cached(cache_key, payload)
    return {**payload, "cached": False}


def answer_learning_question(
    source_text: str, question: str
) -> Dict[str, Any]:
    """Answer a student question strictly grounded in the uploaded educational material."""
    cleaned_text = (source_text or "").strip()
    cleaned_question = (question or "").strip()

    if len(cleaned_text) < 15:
        raise GeminiServiceError(
            "Please load or enter educational material before asking a question.",
            status_code=400,
        )
    if len(cleaned_question) < 3:
        raise GeminiServiceError(
            "Please enter a clear question (at least 3 characters) about your study material.",
            status_code=400,
        )

    cache_key = _make_cache_key("assistant", cleaned_question.lower(), cleaned_text)
    cached = _get_cached(cache_key)
    if cached is not None:
        return {**cached, "cached": True}

    bounded_material = (
        f"{cleaned_text[:36000]}\n\n[Material truncated to 36,000 characters]"
        if len(cleaned_text) > 36000
        else cleaned_text
    )

    client = _get_client()
    model = _get_model()

    schema = types.Schema(
        type=types.Type.OBJECT,
        properties={
            "foundInMaterial": types.Schema(
                type=types.Type.BOOLEAN,
                description="True only if the answer is supported by the provided study material.",
            ),
            "answer": types.Schema(
                type=types.Type.STRING,
                description="Clear, beginner-friendly answer grounded in the study material, or explicit notice that the answer is not available.",
            ),
            "examples": types.Schema(
                type=types.Type.ARRAY,
                description="1 to 2 simple examples illustrating the answer when foundInMaterial is true.",
                items=types.Schema(type=types.Type.STRING),
            ),
            "supportingQuote": types.Schema(
                type=types.Type.STRING,
                description="Short exact snippet from the study material supporting the answer, or empty string.",
            ),
        },
        required=["foundInMaterial", "answer", "examples", "supportingQuote"],
    )

    raw = _generate_with_retry(
        client=client,
        model=model,
        contents=(
            f'Study Material:\n"""\n{bounded_material}\n"""\n\n'
            f"Student Question: {cleaned_question}"
        ),
        config=types.GenerateContentConfig(
            systemInstruction=(
                "You are a strict, student-friendly AI Learning Assistant. "
                "Answer the student question using ONLY the provided Study Material. "
                "Never invent facts or rely on outside knowledge. "
                "If the Study Material does NOT contain enough information to answer the question, "
                "you MUST set foundInMaterial to false, explain clearly that this answer is not available in the uploaded material, "
                "set examples to an empty array, and set supportingQuote to an empty string. "
                "When foundInMaterial is true, answer in simple, encouraging English, include 1-2 relatable examples based on the concept, "
                "and provide a short direct quote from the Study Material as supportingQuote."
            ),
            responseMimeType="application/json",
            responseSchema=schema,
        ),
    )

    parsed = _parse_json_response(raw)
    payload = {
        "foundInMaterial": bool(parsed.get("foundInMaterial", False)),
        "answer": parsed.get(
            "answer", "I could not find an answer in the provided material."
        ),
        "examples": parsed.get("examples", [])
        if isinstance(parsed.get("examples"), list)
        else [],
        "supportingQuote": parsed.get("supportingQuote", "")
        if isinstance(parsed.get("supportingQuote"), str)
        else "",
    }
    _set_cached(cache_key, payload)
    return {**payload, "cached": False}


SUPPORTED_TUTOR_LANGUAGES = [
    {"label": "English", "code": "en", "nativeLabel": "English"},
    {"label": "Spanish", "code": "es", "nativeLabel": "Español"},
    {"label": "French", "code": "fr", "nativeLabel": "Français"},
    {"label": "German", "code": "de", "nativeLabel": "Deutsch"},
    {"label": "Hindi", "code": "hi", "nativeLabel": "हिन्दी"},
    {"label": "Portuguese", "code": "pt", "nativeLabel": "Português"},
    {"label": "Italian", "code": "it", "nativeLabel": "Italiano"},
    {"label": "Japanese", "code": "ja", "nativeLabel": "日本語"},
    {"label": "Korean", "code": "ko", "nativeLabel": "한국어"},
    {"label": "Arabic", "code": "ar", "nativeLabel": "العربية"},
]


def resolve_tutor_language(raw: Optional[str]) -> Dict[str, str]:
    cleaned = (raw or "").strip().lower()
    if not cleaned:
        return SUPPORTED_TUTOR_LANGUAGES[0]
    for item in SUPPORTED_TUTOR_LANGUAGES:
        if (
            item["label"].lower() == cleaned
            or item["code"].lower() == cleaned
            or item["nativeLabel"].lower() == cleaned
        ):
            return item
    return SUPPORTED_TUTOR_LANGUAGES[0]


def _build_tutor_sections(
    explanation: Dict[str, Any], raw_sections: Any
) -> List[Dict[str, Any]]:
    candidates: List[Dict[str, str]] = []
    if isinstance(raw_sections, list) and any(
        isinstance(s, dict) and len((s.get("spokenScript") or "").strip()) > 25
        for s in raw_sections
    ):
        for idx, s in enumerate(raw_sections):
            if not isinstance(s, dict):
                continue
            script = " ".join((s.get("spokenScript") or "").split()).strip()
            if script:
                candidates.append(
                    {
                        "title": (s.get("title") or f"Part {idx + 1}").strip(),
                        "kind": (s.get("kind") or "lesson").strip(),
                        "spokenScript": script,
                    }
                )
    else:
        steps_text = " ".join(
            f"Step {idx + 1}: {s.get('stepTitle', '')}. {s.get('explanation', '')}"
            for idx, s in enumerate(explanation.get("stepByStepExplanation") or [])
        ).strip()
        examples_text = " ".join(
            f"For example, {e.get('title', '')}: {e.get('description', '')}"
            for e in (explanation.get("realWorldExamples") or [])
        ).strip()
        analogies_text = " ".join(
            f"Think of {a.get('concept', '')} like this: {a.get('analogy', '')}"
            for a in (explanation.get("analogies") or [])
        ).strip()
        points = explanation.get("importantPoints") or []
        recap_text = " ".join(
            part
            for part in [
                f"Important points to remember: {' '.join(points)}" if points else "",
                f"To wrap up: {explanation.get('shortRecap', '')}",
            ]
            if part
        ).strip()
        for title, kind, script in [
            (
                "Introduction & Core Meaning",
                "introduction",
                f"{explanation.get('introduction', '')} {explanation.get('meaningAndDefinition', '')}".strip(),
            ),
            ("Step-by-Step Walkthrough", "steps", steps_text),
            (
                "Real-World Examples & Analogies",
                "examples",
                f"{examples_text} {analogies_text}".strip(),
            ),
            ("Key Takeaways & Quick Recap", "recap", recap_text),
        ]:
            if script:
                candidates.append({"title": title, "kind": kind, "spokenScript": script})

    sections: List[Dict[str, Any]] = []
    for idx, item in enumerate(candidates):
        words = len(item["spokenScript"].split())
        sections.append(
            {
                "index": idx,
                "title": item["title"],
                "kind": item["kind"],
                "spokenScript": item["spokenScript"],
                "wordCount": words,
                "estimatedSeconds": max(4, round((words / 145) * 60)),
            }
        )
    return sections


def generate_voice_tutor_explanation(
    topic: str = "",
    content: str = "",
    source_type: str = "topic",
    learning_level: str = "Beginner",
    preferred_language: str = "English",
    source_document_name: str = "",
) -> Dict[str, Any]:
    """Generate a 7-part teacher-style spoken explanation and section list."""
    normalized_level = (
        learning_level
        if learning_level in ("Beginner", "Intermediate", "Advanced")
        else "Beginner"
    )
    normalized_source = (
        source_type
        if source_type in ("topic", "text", "document", "summary", "conversation")
        else "topic"
    )
    lang = resolve_tutor_language(preferred_language)
    cleaned_topic = (topic or "").strip()
    cleaned_content = (content or "").strip()
    effective_topic = (
        cleaned_topic
        or source_document_name
        or (cleaned_content.splitlines()[0][:80].strip() if cleaned_content else "")
        or "Study Topic"
    )

    cache_key = _make_cache_key(
        "voice-tutor",
        normalized_source,
        normalized_level,
        lang["code"],
        effective_topic.lower(),
        cleaned_content[:20000],
    )
    cached = _get_cached(cache_key)
    if cached is not None:
        return {**cached, "cached": True}

    level_guidance = {
        "Beginner": (
            "LEVEL: BEGINNER. Teach like a warm, encouraging private tutor explaining to someone learning this for the first time. "
            "Use short spoken sentences, everyday vocabulary, relatable daily-life examples, and memorable analogies."
        ),
        "Intermediate": (
            "LEVEL: INTERMEDIATE. Teach like an engaging high-school or early-college instructor. "
            "Introduce standard terminology naturally, define technical terms in plain English, and connect concepts with practical examples and analogies."
        ),
        "Advanced": (
            "LEVEL: ADVANCED. Teach like an insightful seminar mentor. "
            "Cover deeper mechanisms, edge cases, and formal principles while keeping spoken sentences clear and easy to follow by ear."
        ),
    }

    client = _get_client()
    model = _get_model()
    effective_content = (
        _condense_long_document(client, model, cleaned_content)
        if len(cleaned_content) > MAX_SINGLE_CALL_CHARS
        else cleaned_content
    )

    schema = types.Schema(
        type=types.Type.OBJECT,
        properties={
            "lessonTitle": types.Schema(type=types.Type.STRING),
            "introduction": types.Schema(type=types.Type.STRING),
            "meaningAndDefinition": types.Schema(type=types.Type.STRING),
            "stepByStepExplanation": types.Schema(
                type=types.Type.ARRAY,
                items=types.Schema(
                    type=types.Type.OBJECT,
                    properties={
                        "stepTitle": types.Schema(type=types.Type.STRING),
                        "explanation": types.Schema(type=types.Type.STRING),
                    },
                    required=["stepTitle", "explanation"],
                ),
            ),
            "realWorldExamples": types.Schema(
                type=types.Type.ARRAY,
                items=types.Schema(
                    type=types.Type.OBJECT,
                    properties={
                        "title": types.Schema(type=types.Type.STRING),
                        "description": types.Schema(type=types.Type.STRING),
                    },
                    required=["title", "description"],
                ),
            ),
            "analogies": types.Schema(
                type=types.Type.ARRAY,
                items=types.Schema(
                    type=types.Type.OBJECT,
                    properties={
                        "concept": types.Schema(type=types.Type.STRING),
                        "analogy": types.Schema(type=types.Type.STRING),
                    },
                    required=["concept", "analogy"],
                ),
            ),
            "importantPoints": types.Schema(
                type=types.Type.ARRAY,
                items=types.Schema(type=types.Type.STRING),
            ),
            "shortRecap": types.Schema(type=types.Type.STRING),
            "sections": types.Schema(
                type=types.Type.ARRAY,
                items=types.Schema(
                    type=types.Type.OBJECT,
                    properties={
                        "title": types.Schema(type=types.Type.STRING),
                        "kind": types.Schema(type=types.Type.STRING),
                        "spokenScript": types.Schema(type=types.Type.STRING),
                    },
                    required=["title", "kind", "spokenScript"],
                ),
            ),
        },
        required=[
            "lessonTitle",
            "introduction",
            "meaningAndDefinition",
            "stepByStepExplanation",
            "realWorldExamples",
            "analogies",
            "importantPoints",
            "shortRecap",
            "sections",
        ],
    )

    material_block = (
        f'Source Material ({normalized_source}{f" · {source_document_name}" if source_document_name else ""}):\n"""\n{effective_content[:26000]}\n"""\n'
        "Teach and explain the ACTUAL concepts contained in this material."
        if effective_content
        else "No external passage was provided; teach the requested topic thoroughly."
    )

    raw = _generate_with_retry(
        client=client,
        model=model,
        contents=(
            f"Target Language: {lang['label']} ({lang['code']})\n\n"
            f"{level_guidance[normalized_level]}\n\n"
            f"Topic / Focus: {effective_topic}\n\n"
            f"{material_block}\n\n"
            f"Divide the spoken lesson into 3 to 6 meaningful sequential sections in {lang['label']} suitable for natural read-aloud."
        ),
        config=types.GenerateContentConfig(
            systemInstruction=(
                "You are an empathetic AI Voice Tutor teaching a student 1-on-1. "
                "Sound like an engaging teacher speaking directly to a student rather than reading textbook prose. "
                "Include (1) Introduction, (2) Meaning & simple definition, (3) Step-by-step explanation, "
                "(4) Real-world examples, (5) Analogies, (6) Important points to remember, and (7) Short recap. "
                "Avoid markdown asterisks inside spokenScript."
            ),
            responseMimeType="application/json",
            responseSchema=schema,
        ),
    )

    parsed = _parse_json_response(raw)
    explanation = {
        "lessonTitle": (parsed.get("lessonTitle") or effective_topic).strip(),
        "introduction": (parsed.get("introduction") or "").strip(),
        "meaningAndDefinition": (parsed.get("meaningAndDefinition") or "").strip(),
        "stepByStepExplanation": parsed.get("stepByStepExplanation")
        if isinstance(parsed.get("stepByStepExplanation"), list)
        else [],
        "realWorldExamples": parsed.get("realWorldExamples")
        if isinstance(parsed.get("realWorldExamples"), list)
        else [],
        "analogies": parsed.get("analogies")
        if isinstance(parsed.get("analogies"), list)
        else [],
        "importantPoints": parsed.get("importantPoints")
        if isinstance(parsed.get("importantPoints"), list)
        else [],
        "shortRecap": (parsed.get("shortRecap") or "").strip(),
    }
    sections = _build_tutor_sections(explanation, parsed.get("sections"))

    payload = {
        "lessonTitle": explanation["lessonTitle"],
        "topic": effective_topic,
        "learningLevel": normalized_level,
        "preferredLanguage": lang["label"],
        "languageCode": lang["code"],
        "sourceType": normalized_source,
        "explanation": explanation,
        "sections": sections,
    }
    _set_cached(cache_key, payload)
    return {**payload, "cached": False}

