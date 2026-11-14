"""Google Gemini API integration with caching, chunking, and grounded Q&A."""

import json
import os
import time
from typing import Any, Dict, List, Optional

import streamlit as st
from dotenv import load_dotenv
from google import genai
from google.genai import errors as genai_errors
from google.genai import types

load_dotenv()

DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"
MAX_DIRECT_INPUT_CHARS = 28000
CHUNK_SIZE_CHARS = 12000


class GeminiServiceError(Exception):
    """Raised when Gemini API configuration or generation fails."""


def _read_secret_or_env(key: str, default: Optional[str] = None) -> Optional[str]:
    """Read a configuration value from Streamlit secrets first, then environment variables."""
    try:
        if key in st.secrets:
            value = str(st.secrets[key]).strip()
            if value:
                return value
    except Exception:
        pass

    env_val = os.getenv(key, "").strip()
    if env_val:
        return env_val
    return default


def get_configured_model() -> str:
    """Return the configured Gemini model name without hardcoding an outdated model."""
    return _read_secret_or_env("GEMINI_MODEL", DEFAULT_GEMINI_MODEL) or DEFAULT_GEMINI_MODEL


def _get_client() -> genai.Client:
    """Initialize and return an authenticated Google Gen AI client."""
    api_key = _read_secret_or_env("GEMINI_API_KEY")
    if not api_key:
        raise GeminiServiceError(
            "Gemini API key not found. Please add GEMINI_API_KEY to your .env file "
            "(for local runs) or Streamlit Secrets (for cloud deployment)."
        )
    return genai.Client(api_key=api_key)


def _parse_json_response(raw_text: Optional[str]) -> Dict[str, Any]:
    """Safely parse JSON returned by Gemini."""
    if not raw_text or not raw_text.strip():
        raise GeminiServiceError("Gemini returned an empty response. Please try again.")

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
            "Could not parse the structured response from Gemini. Please try again."
        ) from exc


def _generate_with_retry(
    client: genai.Client,
    model: str,
    contents: str,
    config: types.GenerateContentConfig,
    retries: int = 2,
) -> str:
    """Call Gemini generate_content with graceful retry on transient rate limits."""
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
            if exc.code in (429, 503) and attempt < retries:
                time.sleep(1.2 * (attempt + 1))
                continue
            raise GeminiServiceError(
                f"Gemini API error ({exc.code}): {exc.message}"
            ) from exc
        except Exception as exc:
            last_exc = exc
            if attempt < retries:
                time.sleep(0.8 * (attempt + 1))
                continue
            raise GeminiServiceError(
                f"Unexpected error while calling Gemini API: {exc}"
            ) from exc

    raise GeminiServiceError(f"Gemini request failed: {last_exc}")


def _split_long_text(text: str, max_chunk_chars: int = CHUNK_SIZE_CHARS) -> List[str]:
    """Split lengthy documents on paragraph boundaries for reliable processing."""
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


def simplify_educational_text(
    text: str, reading_level: str = "Beginner"
) -> Dict[str, Any]:
    """
    Simplify complex educational text into clear English tailored to
    Beginner, Intermediate, or Advanced explanation depth.
    """
    cleaned_text = (text or "").strip()
    if len(cleaned_text) < 15:
        raise GeminiServiceError(
            "Please enter or upload at least a short educational sentence (15+ characters)."
        )

    if len(cleaned_text) > MAX_DIRECT_INPUT_CHARS:
        cleaned_text = _split_long_text(cleaned_text, MAX_DIRECT_INPUT_CHARS)[0]

    level_guidance = {
        "Beginner": (
            "Use very simple everyday English, short clear sentences, and zero unexplained jargon. "
            "Explain every technical term as if teaching a complete beginner."
        ),
        "Intermediate": (
            "Use clear, accessible high-school/early-college English. Keep essential terminology "
            "while defining advanced terms and linking ideas clearly."
        ),
        "Advanced": (
            "Keep full academic precision and domain vocabulary, but clarify dense sentence "
            "structures, explain nuanced mechanisms, and give crisp analytical examples."
        ),
    }
    guidance = level_guidance.get(reading_level, level_guidance["Beginner"])

    client = _get_client()
    model_name = get_configured_model()

    system_instruction = (
        "You are an expert educational accessibility assistant. "
        "Rewrite complicated educational content into clear, structured explanations while "
        "preserving 100% of the original meaning and facts. Never invent facts not present in the source. "
        f"Explanation level ({reading_level}): {guidance}"
    )

    prompt = (
        f"Explanation Level: {reading_level}\n\n"
        "Rewrite the educational content below, explain difficult technical terms, and provide "
        "simple real-world examples. Return valid JSON matching the schema.\n\n"
        f"CONTENT:\n{cleaned_text}"
    )

    schema = types.Schema(
        type=types.Type.OBJECT,
        properties={
            "simplified_text": types.Schema(
                type=types.Type.STRING,
                description="Rewritten educational text tailored to the requested explanation level.",
            ),
            "difficult_concepts": types.Schema(
                type=types.Type.ARRAY,
                description="Technical terms from the passage explained clearly.",
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
                description="Simple real-world examples illustrating the concepts.",
                items=types.Schema(type=types.Type.STRING),
            ),
        },
        required=["simplified_text", "difficult_concepts", "examples"],
    )

    raw = _generate_with_retry(
        client=client,
        model=model_name,
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=system_instruction,
            response_mime_type="application/json",
            response_schema=schema,
        ),
    )
    return _parse_json_response(raw)


def summarize_educational_text(
    text: str, summary_length: str = "Medium"
) -> Dict[str, Any]:
    """
    Generate Short, Medium, or Detailed summaries strictly grounded in the source text,
    including keywords, bullet-point takeaways, and definitions/concepts.
    """
    cleaned_text = (text or "").strip()
    if len(cleaned_text) < 15:
        raise GeminiServiceError(
            "Please enter or upload at least a short educational sentence (15+ characters)."
        )

    length_guidance = {
        "Short": "Write a tight 2-3 sentence overview and 3-4 concise bullet points.",
        "Medium": "Write a balanced 1-2 paragraph summary and 5-7 clear bullet points.",
        "Detailed": (
            "Write a comprehensive multi-paragraph study summary covering every section "
            "and 7-10 thorough bullet points without omitting key mechanisms."
        ),
    }
    guidance = length_guidance.get(summary_length, length_guidance["Medium"])

    client = _get_client()
    model_name = get_configured_model()

    # For very lengthy PDFs, condense chunks first so nothing is silently lost
    source_for_summary = cleaned_text
    if len(cleaned_text) > MAX_DIRECT_INPUT_CHARS:
        chunks = _split_long_text(cleaned_text, CHUNK_SIZE_CHARS)[:5]
        notes: List[str] = []
        for idx, chunk in enumerate(chunks, start=1):
            chunk_prompt = (
                f"Extract the key facts, terms, and definitions strictly from Part {idx} below. "
                "Do not add outside information.\n\n"
                f"{chunk}"
            )
            notes.append(
                _generate_with_retry(
                    client=client,
                    model=model_name,
                    contents=chunk_prompt,
                    config=types.GenerateContentConfig(
                        system_instruction="You extract faithful study notes strictly from provided text."
                    ),
                )
            )
        source_for_summary = "\n\n".join(notes)

    system_instruction = (
        "You are a factual educational study assistant. "
        "Summarize the provided material strictly using ONLY facts present in the source text. "
        "Never introduce outside facts or assumptions not supported by the original text. "
        f"Length requirement ({summary_length}): {guidance}"
    )

    prompt = (
        f"Summary Length: {summary_length}\n\n"
        "Summarize the educational material below. Extract important keywords, important points in "
        "bullet format, and important definitions/concepts supported by the text. Return valid JSON.\n\n"
        f"CONTENT:\n{source_for_summary}"
    )

    schema = types.Schema(
        type=types.Type.OBJECT,
        properties={
            "summary_text": types.Schema(
                type=types.Type.STRING,
                description="Grounded summary matching the requested Short, Medium, or Detailed length.",
            ),
            "keywords": types.Schema(
                type=types.Type.ARRAY,
                description="Important keywords extracted directly from the material.",
                items=types.Schema(type=types.Type.STRING),
            ),
            "bullet_points": types.Schema(
                type=types.Type.ARRAY,
                description="Important study takeaways in bullet format.",
                items=types.Schema(type=types.Type.STRING),
            ),
            "key_concepts": types.Schema(
                type=types.Type.ARRAY,
                description="Important definitions and concepts supported by the text.",
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
        required=["summary_text", "keywords", "bullet_points", "key_concepts"],
    )

    raw = _generate_with_retry(
        client=client,
        model=model_name,
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=system_instruction,
            response_mime_type="application/json",
            response_schema=schema,
        ),
    )
    return _parse_json_response(raw)


def answer_learning_question(
    source_text: str, question: str
) -> Dict[str, Any]:
    """
    Answer a student's question strictly using the uploaded educational content.
    Explicitly indicates when the answer is not available in the material.
    """
    cleaned_source = (source_text or "").strip()
    cleaned_question = (question or "").strip()

    if not cleaned_source:
        raise GeminiServiceError(
            "Please upload a PDF/TXT or enter educational text before asking questions."
        )
    if len(cleaned_question) < 3:
        raise GeminiServiceError("Please enter a clear question (3+ characters).")

    if len(cleaned_source) > MAX_DIRECT_INPUT_CHARS:
        cleaned_source = cleaned_source[:MAX_DIRECT_INPUT_CHARS]

    client = _get_client()
    model_name = get_configured_model()

    system_instruction = (
        "You are a strictly grounded AI Learning Assistant helping a student understand their uploaded study material. "
        "CRITICAL RULES:\n"
        "1. Answer ONLY using facts explicitly supported by the PROVIDED MATERIAL.\n"
        "2. Do NOT invent answers or pull in outside facts not present in the material.\n"
        "3. If the answer cannot be determined from the provided material, set found_in_material to false "
        "and clearly explain in 'answer' that this information is not available in the uploaded material.\n"
        "4. When the answer IS in the material, explain it in simple, student-friendly language and include "
        "helpful examples grounded in the text."
    )

    prompt = (
        f"PROVIDED MATERIAL:\n{cleaned_source}\n\n"
        f"STUDENT QUESTION:\n{cleaned_question}\n\n"
        "Return valid JSON matching the schema."
    )

    schema = types.Schema(
        type=types.Type.OBJECT,
        properties={
            "found_in_material": types.Schema(
                type=types.Type.BOOLEAN,
                description="True if the provided material contains enough information to answer; False otherwise.",
            ),
            "answer": types.Schema(
                type=types.Type.STRING,
                description="Clear, simple answer grounded in the material, or an explicit statement that it is not available.",
            ),
            "examples": types.Schema(
                type=types.Type.ARRAY,
                description="Simple supporting examples from the material (empty list if not found).",
                items=types.Schema(type=types.Type.STRING),
            ),
            "supporting_quote": types.Schema(
                type=types.Type.STRING,
                description="A brief relevant phrase from the material supporting the answer (empty if not found).",
            ),
        },
        required=["found_in_material", "answer", "examples", "supporting_quote"],
    )

    raw = _generate_with_retry(
        client=client,
        model=model_name,
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=system_instruction,
            response_mime_type="application/json",
            response_schema=schema,
        ),
    )
    return _parse_json_response(raw)


@st.cache_data(show_spinner=False, ttl=3600)
def cached_simplify_educational_text(
    text: str, reading_level: str = "Beginner"
) -> Dict[str, Any]:
    """Cached wrapper to prevent duplicate Gemini API calls."""
    return simplify_educational_text(text=text, reading_level=reading_level)


@st.cache_data(show_spinner=False, ttl=3600)
def cached_summarize_educational_text(
    text: str, summary_length: str = "Medium"
) -> Dict[str, Any]:
    """Cached wrapper to prevent duplicate Gemini API calls."""
    return summarize_educational_text(text=text, summary_length=summary_length)


@st.cache_data(show_spinner=False, ttl=3600)
def cached_answer_learning_question(
    source_text: str, question: str
) -> Dict[str, Any]:
    """Cached wrapper for grounded Q&A."""
    return answer_learning_question(source_text=source_text, question=question)
