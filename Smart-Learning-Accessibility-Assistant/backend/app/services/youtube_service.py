"""YouTube Data API v3 + Gemini service for educational learning video discovery."""

from collections import deque
from html import unescape
import json
import math
import re
import time
from typing import Any, Dict, List, Optional

from google import genai
from google.genai import types
import httpx
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Conversation, Document, VideoRecommendation


class YouTubeRecommendationError(Exception):
    """Domain error with an explicit HTTP status code for YouTube recommendation failures."""

    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message


class YouTubeServiceError(YouTubeRecommendationError):
    """Backward-compatible alias accepting (message, status_code) or (status_code, message)."""

    def __init__(self, first: Any, second: Any = 500) -> None:
        if isinstance(first, int):
            super().__init__(first, str(second))
        else:
            super().__init__(int(second), str(first))


LANGUAGE_MAP = {
    "english": "en",
    "en": "en",
    "spanish": "es",
    "es": "es",
    "hindi": "hi",
    "hi": "hi",
    "french": "fr",
    "fr": "fr",
    "german": "de",
    "de": "de",
    "arabic": "ar",
    "ar": "ar",
    "portuguese": "pt",
    "pt": "pt",
    "japanese": "ja",
    "ja": "ja",
    "korean": "ko",
    "ko": "ko",
    "chinese": "zh-Hans",
    "zh": "zh-Hans",
}

STOPWORDS = {
    "about", "above", "after", "again", "against", "almost", "alone", "along",
    "already", "also", "although", "always", "among", "another", "answer", "around",
    "because", "become", "before", "being", "below", "between", "both", "called",
    "cannot", "could", "course", "describe", "does", "doing", "during", "each",
    "either", "enough", "every", "example", "explain", "explained", "first",
    "following", "found", "from", "further", "gives", "great", "have", "having",
    "helpful", "here", "however", "important", "include", "including", "inside",
    "into", "itself", "just", "known", "learn", "learning", "lesson", "like",
    "made", "make", "many", "material", "mean", "meaning", "might", "more",
    "most", "much", "must", "nearly", "need", "never", "only", "other", "others",
    "otherwise", "over", "page", "paragraph", "part", "passage", "process",
    "question", "quite", "rather", "really", "same", "section", "several",
    "shall", "should", "since", "some", "someone", "something", "sometimes",
    "still", "student", "study", "such", "summary", "take", "than", "that",
    "their", "them", "then", "there", "these", "they", "thing", "think", "this",
    "those", "though", "through", "thus", "together", "toward", "under",
    "understand", "until", "upon", "used", "using", "usually", "very", "video",
    "want", "watch", "well", "were", "what", "when", "where", "which", "while",
    "whom", "whose", "will", "with", "within", "without", "word", "words",
    "work", "works", "would", "your", "yours",
}

_RATE_HITS: Dict[str, deque[float]] = {}
_CACHE: Dict[str, tuple[float, Dict[str, Any]]] = {}
_CACHE_TTL_SECONDS = 900.0


def check_rate_limit(user_id: str, max_requests: int = 15, window_seconds: float = 60.0) -> None:
    now = time.monotonic()
    bucket = _RATE_HITS.setdefault(user_id, deque())
    cutoff = now - window_seconds
    while bucket and bucket[0] <= cutoff:
        bucket.popleft()
    if len(bucket) >= max_requests:
        retry_after = max(1, int(math.ceil(bucket[0] + window_seconds - now)))
        raise YouTubeRecommendationError(
            429,
            f"Too many video recommendation requests. Please wait {retry_after} second(s) and try again.",
        )
    bucket.append(now)


def normalize_learning_level(level: Optional[str]) -> str:
    if level in ("Intermediate", "Advanced"):
        return level
    return "Beginner"


def map_language_code(preferred_language: Optional[str]) -> str:
    key = (preferred_language or "English").strip().lower()
    return LANGUAGE_MAP.get(key, "en")


def parse_duration_seconds(iso_duration: Optional[str]) -> int:
    if not iso_duration:
        return 0
    match = re.match(r"^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$", iso_duration.strip(), re.I)
    if not match:
        return 0
    hours = int(match.group(1) or 0)
    minutes = int(match.group(2) or 0)
    seconds = int(match.group(3) or 0)
    return hours * 3600 + minutes * 60 + seconds


def parse_iso8601_duration(iso_duration: Optional[str]) -> str:
    total_seconds = parse_duration_seconds(iso_duration)
    if total_seconds <= 0:
        return ""
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    seconds = total_seconds % 60
    if hours > 0:
        return f"{hours}:{minutes:02d}:{seconds:02d}"
    return f"{minutes}:{seconds:02d}"


def extract_keywords_heuristic(text: str, limit: int = 5) -> List[str]:
    cleaned = re.sub(r"\[Page \d+\]", " ", text, flags=re.I)
    cleaned = re.sub(r"[^a-zA-Z0-9\s-]", " ", cleaned).lower()
    counts: Dict[str, int] = {}
    for raw_token in cleaned.split():
        word = raw_token.strip("-")
        if len(word) < 4 or word.isdigit() or word in STOPWORDS:
            continue
        counts[word] = counts.get(word, 0) + 1
    ranked = sorted(counts.items(), key=lambda kv: (-kv[1], -len(kv[0])))
    return [word for word, _ in ranked[:limit]]


def build_fallback_query(
    topic_or_text: str,
    custom_topic: str,
    keywords: Optional[List[str]],
    learning_level: str,
    preferred_language: str,
) -> Dict[str, Any]:
    custom = (custom_topic or "").strip()
    cleaned_kw = [k.strip() for k in (keywords or []) if k and k.strip()][:6]
    source_text = custom or (topic_or_text or "").strip()
    extracted = cleaned_kw or extract_keywords_heuristic(source_text, limit=5)

    if custom:
        topic = custom
    else:
        first_sentence = re.split(r"[.!?\n]", re.sub(r"\[Page \d+\]\s*", "", source_text))[0].strip()
        if first_sentence and len(first_sentence) <= 80 and len(first_sentence.split()) <= 10:
            topic = first_sentence
        elif extracted:
            topic = " ".join(w.capitalize() for w in extracted[:3])
        else:
            topic = source_text[:60].strip() or "Study Topic"

    level_qualifier = {
        "Beginner": "explained for beginners tutorial",
        "Intermediate": "concept explanation tutorial",
        "Advanced": "in depth lecture explained",
    }.get(learning_level, "explained for beginners tutorial")

    lang_suffix = (
        f" in {preferred_language.strip()}"
        if preferred_language and preferred_language.strip().lower() != "english"
        else ""
    )
    core_terms = custom or (" ".join(extracted[:4]) if extracted else topic)
    search_query = re.sub(r"\s+", " ", f"{core_terms} {level_qualifier}{lang_suffix}").strip()
    return {
        "topic": topic,
        "keywords": extracted or topic.lower().split()[:4],
        "searchQuery": search_query,
    }


def _analyze_topic_with_gemini(
    content: str,
    custom_topic: str,
    keywords: List[str],
    learning_level: str,
    preferred_language: str,
    source_type: str,
) -> Dict[str, Any]:
    fallback = build_fallback_query(
        content, custom_topic, keywords, learning_level, preferred_language
    )
    settings = get_settings()
    api_key = (settings.gemini_api_key or "").strip()
    if not api_key:
        return fallback

    try:
        client = genai.Client(api_key=api_key)
        parts = [
            f"Student Learning Level: {learning_level}",
            f"Preferred Video Language: {preferred_language}",
            f"Source Type: {source_type}",
        ]
        if custom_topic.strip():
            parts.append(f"Explicit Student Topic Request: {custom_topic.strip()}")
        if keywords:
            parts.append(f"Pre-extracted Keywords: {', '.join(keywords)}")
        if content.strip():
            parts.append(f"Study Content / Context:\n\"\"\"\n{content[:8000]}\n\"\"\"")

        schema = types.Schema(
            type=types.Type.OBJECT,
            properties={
                "topic": types.Schema(type=types.Type.STRING),
                "keywords": types.Schema(
                    type=types.Type.ARRAY,
                    items=types.Schema(type=types.Type.STRING),
                ),
                "searchQuery": types.Schema(type=types.Type.STRING),
            },
            required=["topic", "keywords", "searchQuery"],
        )
        res = client.models.generate_content(
            model=settings.gemini_model,
            contents="\n\n".join(parts),
            config=types.GenerateContentConfig(
                system_instruction=(
                    "Extract the core academic topic, 3 to 6 relevant keywords, and a clean "
                    "YouTube educational search query targeting tutorials or explanations "
                    "matching the requested learning level and preferred language."
                ),
                response_mime_type="application/json",
                response_schema=schema,
            ),
        )
        parsed = json.loads((res.text or "{}").strip())
        return {
            "topic": (parsed.get("topic") or fallback["topic"]).strip(),
            "keywords": parsed.get("keywords") or fallback["keywords"],
            "searchQuery": (parsed.get("searchQuery") or fallback["searchQuery"]).strip(),
        }
    except Exception:
        return fallback


def score_and_filter_candidates(
    candidates: List[Dict[str, Any]],
    topic: str,
    keywords: List[str],
    learning_level: str,
) -> List[Dict[str, Any]]:
    seen = set()
    norm_keywords = list(
        dict.fromkeys(
            k.strip().lower()
            for k in [*keywords, *topic.split()]
            if k and len(k.strip()) >= 3 and k.strip().lower() not in STOPWORDS
        )
    )

    pos_rules = [
        (r"\b(explained|explanation|tutorial|lesson|lecture|course|crash course)\b", 18),
        (r"\b(introduction|intro|basics|fundamentals|overview|guide|walkthrough)\b", 14),
        (r"\b(visual|animation|animated|demonstration|demo|step by step|how .+ works)\b", 15),
        (r"\b(khan academy|mit|stanford|harvard|ted-ed|crashcourse|3blue1brown|amoeba sisters|kurzgesagt|academy|professor)\b", 22),
    ]
    neg_rules = [
        (r"\b(prank|roast|reaction|reacts|tiktok|memes?|funny moments|unboxing|vlog|gossip|official music video|gameplay)\b", -50),
        (r"#shorts?\b", -35),
        (r"\b(top 10 shocking|you won't believe|gone wrong|clickbait)\b", -40),
    ]

    scored = []
    for item in candidates:
        vid = item.get("videoId")
        if not vid or vid in seen:
            continue
        seen.add(vid)
        title = unescape((item.get("title") or "").strip())
        if not title:
            continue
        desc = unescape((item.get("description") or "").strip())
        channel = unescape((item.get("channelName") or "Educational Channel").strip())
        combined = f"{title} {desc} {channel}".lower()
        seconds = parse_duration_seconds(item.get("durationIso")) or int(
            item.get("durationSeconds") or 0
        )

        score = 0.0
        matched = []
        for kw in norm_keywords:
            if kw in title.lower():
                score += 18
                matched.append(kw)
            elif kw in combined:
                score += 8
                matched.append(kw)

        for pattern, weight in pos_rules:
            if re.search(pattern, combined, re.I):
                score += weight
        for pattern, weight in neg_rules:
            if re.search(pattern, combined, re.I):
                score += weight

        if item.get("categoryId") == "27":
            score += 16
        elif item.get("categoryId") == "28":
            score += 10

        if learning_level == "Beginner" and re.search(r"\b(beginner|intro|basics|simple|101)\b", combined, re.I):
            score += 14
        elif learning_level == "Intermediate" and re.search(r"\b(explained|visual|deep dive|guide)\b", combined, re.I):
            score += 12
        elif learning_level == "Advanced" and re.search(r"\b(lecture|university|advanced|proof|mit)\b", combined, re.I):
            score += 14

        if 0 < seconds < 60:
            score -= 25
        elif 120 <= seconds <= 2700:
            score += 12
        elif seconds > 2700:
            score += 4

        view_count = item.get("viewCount") or 0
        if view_count > 1000:
            score += min(10.0, math.log10(view_count))

        duration = parse_iso8601_duration(item.get("durationIso"))
        matched_label = ", ".join(matched[:3]) if matched else topic
        reason = (
            f"Recommended {learning_level.lower()}-friendly lesson by {channel} covering {matched_label}."
            if seconds >= 120
            else f"Helpful educational explanation from {channel} focused on {matched_label}."
        )

        scored.append(
            (
                score,
                {
                    "videoId": vid,
                    "title": title,
                    "thumbnailUrl": item.get("thumbnailUrl")
                    or f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
                    "channelName": channel,
                    "videoUrl": f"https://www.youtube.com/watch?v={vid}",
                    "duration": duration,
                    "recommendationReason": reason,
                },
            )
        )

    good = [pair for pair in scored if pair[0] > -10]
    pool = good if good else [pair for pair in scored if pair[0] > -35]
    pool.sort(key=lambda pair: pair[0], reverse=True)
    return [pair[1] for pair in pool[:5]]


def _fetch_youtube_candidates(
    api_key: str, search_query: str, relevance_language: str
) -> List[Dict[str, Any]]:
    def _run_search(query: str, category_id: Optional[str] = None) -> List[Dict[str, Any]]:
        params = {
            "part": "snippet",
            "type": "video",
            "maxResults": "12",
            "safeSearch": "strict",
            "videoEmbeddable": "true",
            "relevanceLanguage": relevance_language,
            "q": query,
            "key": api_key,
        }
        if category_id:
            params["videoCategoryId"] = category_id
        resp = httpx.get(
            "https://www.googleapis.com/youtube/v3/search",
            params=params,
            timeout=15.0,
        )
        if not resp.is_success:
            raise _translate_youtube_http_error(resp)
        return resp.json().get("items") or []

    def _translate_youtube_http_error(resp: httpx.Response) -> YouTubeRecommendationError:
        reason = ""
        message = ""
        try:
            err_json = resp.json()
            reason = (err_json.get("error", {}).get("errors") or [{}])[0].get("reason", "")
            message = err_json.get("error", {}).get("message", "")
        except Exception:
            pass
        if resp.status_code == 403 and "quota" in reason.lower():
            return YouTubeRecommendationError(
                429,
                "YouTube Data API daily quota exceeded. Please try again later.",
            )
        if resp.status_code in (400, 401, 403) and (
            reason == "keyInvalid" or "api key" in message.lower()
        ):
            return YouTubeRecommendationError(
                503,
                "YouTube Data API authentication failed. Please check YOUTUBE_API_KEY.",
            )
        return YouTubeRecommendationError(
            502, message or f"YouTube Data API returned status {resp.status_code}."
        )

    search_items = _run_search(search_query, "27")
    if len(search_items) < 4:
        broadened = _run_search(f"{search_query} tutorial lesson")
        seen = {i.get("id", {}).get("videoId") for i in search_items}
        for item in broadened:
            vid = item.get("id", {}).get("videoId")
            if vid and vid not in seen:
                seen.add(vid)
                search_items.append(item)

    video_ids = [
        item.get("id", {}).get("videoId")
        for item in search_items
        if item.get("id", {}).get("videoId")
    ][:15]
    if not video_ids:
        return []

    detail_resp = httpx.get(
        "https://www.googleapis.com/youtube/v3/videos",
        params={
            "part": "snippet,contentDetails,statistics",
            "id": ",".join(video_ids),
            "key": api_key,
        },
        timeout=15.0,
    )
    if not detail_resp.is_success:
        raise _translate_youtube_http_error(detail_resp)

    details_by_id = {
        d.get("id"): d for d in (detail_resp.json().get("items") or []) if d.get("id")
    }

    candidates = []
    for vid in video_ids:
        detail = details_by_id.get(vid, {})
        search_match = next(
            (s for s in search_items if s.get("id", {}).get("videoId") == vid), {}
        )
        snippet = detail.get("snippet") or search_match.get("snippet") or {}
        thumbs = snippet.get("thumbnails") or {}
        thumb_url = (
            thumbs.get("high", {}).get("url")
            or thumbs.get("medium", {}).get("url")
            or thumbs.get("default", {}).get("url")
            or f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"
        )
        stats = detail.get("statistics") or {}
        candidates.append(
            {
                "videoId": vid,
                "title": snippet.get("title") or "Educational Video",
                "description": snippet.get("description") or "",
                "thumbnailUrl": thumb_url,
                "channelName": snippet.get("channelTitle") or "Educational Channel",
                "durationIso": (detail.get("contentDetails") or {}).get("duration"),
                "viewCount": int(stats["viewCount"]) if stats.get("viewCount") else 0,
                "categoryId": snippet.get("categoryId"),
            }
        )
    return candidates


def serialize_video_recommendation(row: VideoRecommendation) -> Dict[str, Any]:
    return {
        "id": row.id,
        "conversationId": row.conversation_id,
        "documentId": row.document_id,
        "sourceType": row.source_type,
        "topic": row.topic,
        "searchQuery": row.search_query,
        "learningLevel": row.learning_level,
        "preferredLanguage": row.preferred_language,
        "keywords": row.keywords_json or [],
        "videos": row.videos_json or [],
        "createdAt": row.created_at.isoformat() if row.created_at else None,
    }


def generate_youtube_recommendations(
    db: Session,
    user_id: str,
    content: str = "",
    custom_topic: str = "",
    keywords: Optional[List[str]] = None,
    learning_level: str = "Beginner",
    preferred_language: str = "English",
    source_type: str = "text",
    document_id: Optional[str] = None,
    conversation_id: Optional[str] = None,
    force_refresh: bool = False,
    save_to_history: bool = True,
) -> Dict[str, Any]:
    check_rate_limit(user_id)

    effective_content = (content or "").strip()
    trimmed_custom = (custom_topic or "").strip()

    owned_doc_id = None
    if document_id:
        doc = db.execute(
            select(Document).where(Document.id == document_id, Document.user_id == user_id)
        ).scalar_one_or_none()
        if doc:
            owned_doc_id = doc.id
            if not effective_content:
                effective_content = doc.extracted_text

    owned_conv_id = None
    if conversation_id:
        conv = db.execute(
            select(Conversation).where(
                Conversation.id == conversation_id, Conversation.user_id == user_id
            )
        ).scalar_one_or_none()
        if conv:
            owned_conv_id = conv.id
            if not effective_content:
                effective_content = conv.title

    if len(effective_content) < 3 and len(trimmed_custom) < 2:
        raise YouTubeRecommendationError(
            400,
            "Please provide a custom topic, study text, summary, or question to recommend videos.",
        )

    settings = get_settings()
    youtube_api_key = (settings.youtube_api_key or "").strip()
    if not youtube_api_key:
        raise YouTubeRecommendationError(
            503,
            "YouTube Data API v3 key (YOUTUBE_API_KEY) is not configured on the backend server.",
        )

    norm_level = normalize_learning_level(learning_level)
    norm_lang = (preferred_language or "English").strip() or "English"
    lang_code = map_language_code(norm_lang)
    norm_source = "custom" if (trimmed_custom and not effective_content) else (source_type or "text")

    cache_key = "|".join(
        [
            trimmed_custom.lower(),
            effective_content[:1200].lower(),
            ",".join(keywords or []).lower(),
            norm_level.lower(),
            lang_code,
        ]
    )

    cached_payload = None
    if not force_refresh and cache_key in _CACHE:
        expires_at, data = _CACHE[cache_key]
        if time.monotonic() < expires_at:
            cached_payload = data
        else:
            del _CACHE[cache_key]

    if cached_payload:
        result_payload = {**cached_payload, "sourceType": norm_source, "cached": True}
    else:
        analysis = _analyze_topic_with_gemini(
            effective_content,
            trimmed_custom,
            list(keywords or []),
            norm_level,
            norm_lang,
            norm_source,
        )
        candidates = _fetch_youtube_candidates(
            youtube_api_key, analysis["searchQuery"], lang_code
        )
        videos = score_and_filter_candidates(
            candidates, analysis["topic"], analysis["keywords"], norm_level
        )
        result_payload = {
            "topic": analysis["topic"],
            "keywords": analysis["keywords"],
            "searchQuery": analysis["searchQuery"],
            "learningLevel": norm_level,
            "preferredLanguage": norm_lang,
            "sourceType": norm_source,
            "videos": videos,
            "cached": False,
        }
        if videos:
            _CACHE[cache_key] = (time.monotonic() + _CACHE_TTL_SECONDS, result_payload)

    saved_id = None
    created_at = None
    if save_to_history and result_payload["videos"]:
        record = VideoRecommendation(
            user_id=user_id,
            conversation_id=owned_conv_id,
            document_id=owned_doc_id,
            source_type=result_payload["sourceType"],
            topic=result_payload["topic"][:240],
            search_query=result_payload["searchQuery"][:300],
            learning_level=norm_level,
            preferred_language=norm_lang[:40],
            keywords_json=result_payload["keywords"],
            videos_json=result_payload["videos"],
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        saved_id = record.id
        created_at = record.created_at.isoformat() if record.created_at else None

    return {
        "id": saved_id,
        "conversationId": owned_conv_id,
        "documentId": owned_doc_id,
        **result_payload,
        "createdAt": created_at,
    }


recommend_youtube_videos = generate_youtube_recommendations


def list_user_video_recommendations(
    db: Session,
    user_id: str,
    conversation_id: Optional[str] = None,
    query: Optional[str] = None,
) -> List[Dict[str, Any]]:
    stmt = select(VideoRecommendation).where(VideoRecommendation.user_id == user_id)
    if conversation_id:
        stmt = stmt.where(VideoRecommendation.conversation_id == conversation_id)
    cleaned = (query or "").strip()
    if cleaned:
        pattern = f"%{cleaned}%"
        stmt = stmt.where(
            or_(
                VideoRecommendation.topic.ilike(pattern),
                VideoRecommendation.search_query.ilike(pattern),
            )
        )
    stmt = stmt.order_by(VideoRecommendation.created_at.desc())
    rows = db.execute(stmt).scalars().all()
    return [serialize_video_recommendation(r) for r in rows]


def delete_user_video_recommendation(db: Session, user_id: str, rec_id: str) -> bool:
    row = db.execute(
        select(VideoRecommendation).where(
            VideoRecommendation.id == rec_id,
            VideoRecommendation.user_id == user_id,
        )
    ).scalar_one_or_none()
    if row is None:
        return False
    db.delete(row)
    db.commit()
    return True
