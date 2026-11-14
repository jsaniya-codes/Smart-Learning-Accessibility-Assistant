"""Automated API and persistence tests for Smart Learning Accessibility Assistant."""

from io import BytesIO
from pathlib import Path
import sys
from unittest.mock import patch

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.database import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.services.pdf_service import normalize_page_text  # noqa: E402
from app.services.speech_service import split_text_into_speech_chunks  # noqa: E402


@pytest.fixture()
def client_and_db(tmp_path):
    """Provide an isolated temporary SQLite database and TestClient per test."""
    db_file = tmp_path / "test_smart_learning.db"
    test_engine = create_engine(
        f"sqlite:///{db_file}",
        connect_args={"check_same_thread": False},
        future=True,
    )

    @event.listens_for(test_engine, "connect")
    def _enable_fk(dbapi_connection, _record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    TestingSessionLocal = sessionmaker(
        autocommit=False,
        autoflush=False,
        bind=test_engine,
        expire_on_commit=False,
    )
    Base.metadata.create_all(bind=test_engine)

    def _override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    test_engine.dispose()


def _register_and_headers(client: TestClient, name: str, email: str, password: str = "StrongPass123!") -> tuple[dict, str]:
    res = client.post(
        "/api/auth/register",
        json={"fullName": name, "email": email, "password": password},
    )
    assert res.status_code == 201, res.text
    body = res.json()
    token = body["accessToken"]
    return {"Authorization": f"Bearer {token}"}, body["user"]["id"]


def _build_minimal_pdf(text_content: str) -> bytes:
    """Create a valid minimal single-page PDF containing selectable text."""
    escaped = (
        text_content.replace("\\", "\\\\")
        .replace("(", "\\(")
        .replace(")", "\\)")
    )
    stream_body = f"BT\n/F1 12 Tf\n72 720 Td\n({escaped}) Tj\nET\n".encode("latin-1")

    objects = [
        b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
        b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
        b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
        (
            f"4 0 obj\n<< /Length {len(stream_body)} >>\nstream\n".encode("latin-1")
            + stream_body
            + b"\nendstream\nendobj\n"
        ),
        b"5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    ]

    pdf = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for obj in objects:
        offsets.append(len(pdf))
        pdf.extend(obj)

    xref_pos = len(pdf)
    pdf.extend(f"xref\n0 {len(objects) + 1}\n".encode("latin-1"))
    pdf.extend(b"0000000000 65535 f \n")
    for off in offsets[1:]:
        pdf.extend(f"{off:010d} 00000 n \n".encode("latin-1"))
    pdf.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n".encode(
            "latin-1"
        )
    )
    return bytes(pdf)


def test_health_and_unauthenticated_protection(client_and_db):
    client = client_and_db
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json()["ok"] is True

    # Protected endpoints must reject missing Bearer tokens with 401
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/chats").status_code == 401
    assert client.get("/api/documents").status_code == 401
    assert client.get("/api/history").status_code == 401
    assert client.get("/api/learning-results").status_code == 401
    assert client.post("/api/simplify", json={"text": "Some study passage here.", "readingLevel": "Beginner"}).status_code == 401
    assert client.post("/api/speech", json={"text": "Read this aloud."}).status_code == 401


def test_auth_register_login_duplicate_logout_me(client_and_db):
    client = client_and_db
    headers, user_id = _register_and_headers(client, "Alice Student", "alice@example.edu")

    # Duplicate email conflict
    dup = client.post(
        "/api/auth/register",
        json={"fullName": "Alice Two", "email": "ALICE@example.edu", "password": "Password123!"},
    )
    assert dup.status_code == 409

    # Wrong password rejected
    bad_login = client.post(
        "/api/auth/login",
        json={"email": "alice@example.edu", "password": "WrongPassword"},
    )
    assert bad_login.status_code == 401

    # Valid login returns JWT and matching user
    good_login = client.post(
        "/api/auth/login",
        json={"email": "alice@example.edu", "password": "StrongPass123!"},
    )
    assert good_login.status_code == 200
    assert good_login.json()["user"]["id"] == user_id

    me_res = client.get("/api/auth/me", headers=headers)
    assert me_res.status_code == 200
    assert me_res.json()["user"]["email"] == "alice@example.edu"

    logout_res = client.post("/api/auth/logout", headers=headers)
    assert logout_res.status_code == 200
    assert logout_res.json()["ok"] is True


def test_persistent_documents_upload_list_reopen_download_delete(client_and_db):
    client = client_and_db
    headers_a, _ = _register_and_headers(client, "Alice", "alice@example.edu")
    headers_b, _ = _register_and_headers(client, "Bob", "bob@example.edu")

    sample = "Photosynthesis converts solar energy into chemical energy stored in glucose."
    res_up = client.post(
        "/api/documents/upload",
        headers=headers_a,
        files={"file": ("notes.txt", BytesIO(sample.encode("utf-8")), "text/plain")},
    )
    assert res_up.status_code == 200
    doc_data = res_up.json()
    doc_id = doc_data["id"]
    assert doc_data["fileType"] == "TXT"
    assert doc_data["wordCount"] == 10
    assert doc_data["text"] == sample

    # PDF upload also persists
    pdf_bytes = _build_minimal_pdf("Cellular respiration generates ATP in mitochondria.")
    res_pdf = client.post(
        "/api/documents/upload",
        headers=headers_a,
        files={"file": ("biology.pdf", BytesIO(pdf_bytes), "application/pdf")},
    )
    assert res_pdf.status_code == 200
    assert res_pdf.json()["fileType"] == "PDF"
    assert "Cellular respiration generates ATP" in res_pdf.json()["text"]

    # List documents for Alice returns 2; Bob sees 0
    list_a = client.get("/api/documents", headers=headers_a)
    assert list_a.status_code == 200
    assert len(list_a.json()["documents"]) == 2

    list_b = client.get("/api/documents", headers=headers_b)
    assert list_b.status_code == 200
    assert list_b.json()["documents"] == []

    # Reopen document as Alice works; Bob gets 404
    reopen_a = client.get(f"/api/documents/{doc_id}", headers=headers_a)
    assert reopen_a.status_code == 200
    assert reopen_a.json()["text"] == sample

    assert client.get(f"/api/documents/{doc_id}", headers=headers_b).status_code == 404
    assert client.get(f"/api/documents/{doc_id}/download", headers=headers_b).status_code == 404
    assert client.delete(f"/api/documents/{doc_id}", headers=headers_b).status_code == 404

    # Download original binary bytes from DB
    dl_a = client.get(f"/api/documents/{doc_id}/download", headers=headers_a)
    assert dl_a.status_code == 200
    assert dl_a.content == sample.encode("utf-8")

    # Delete as Alice
    del_a = client.delete(f"/api/documents/{doc_id}", headers=headers_a)
    assert del_a.status_code == 204
    assert client.get(f"/api/documents/{doc_id}", headers=headers_a).status_code == 404


def test_document_upload_validation_errors(client_and_db):
    client = client_and_db
    headers, _ = _register_and_headers(client, "Alice", "alice@example.edu")

    res_ext = client.post(
        "/api/documents/upload",
        headers=headers,
        files={"file": ("slides.docx", BytesIO(b"hello"), "application/octet-stream")},
    )
    assert res_ext.status_code == 400

    res_empty = client.post(
        "/api/documents/upload",
        headers=headers,
        files={"file": ("empty.txt", BytesIO(b""), "text/plain")},
    )
    assert res_empty.status_code == 400

    empty_pdf = _build_minimal_pdf("")
    res_ocr = client.post(
        "/api/documents/upload",
        headers=headers,
        files={"file": ("scanned.pdf", BytesIO(empty_pdf), "application/pdf")},
    )
    assert res_ocr.status_code == 422
    assert "OCR" in res_ocr.json()["detail"]

    analyze_res = client.post(
        "/api/documents/analyze",
        headers=headers,
        json={"text": "One two three four five six."},
    )
    assert analyze_res.status_code == 200
    assert analyze_res.json() == {"wordCount": 6, "charCount": 28, "estimatedMinutes": 1}


def test_persistent_chats_messages_rename_search_delete_and_isolation(client_and_db):
    client = client_and_db
    headers_a, _ = _register_and_headers(client, "Alice", "alice@example.edu")
    headers_b, _ = _register_and_headers(client, "Bob", "bob@example.edu")

    # Upload a document for Alice to attach to chat
    doc_res = client.post(
        "/api/documents/upload",
        headers=headers_a,
        files={
            "file": (
                "chloroplast.txt",
                BytesIO(b"Chlorophyll pigments absorb red and blue wavelengths inside plant chloroplasts."),
                "text/plain",
            )
        },
    )
    doc_id = doc_res.json()["id"]

    # Create chat
    chat_res = client.post(
        "/api/chats",
        headers=headers_a,
        json={"documentId": doc_id},
    )
    assert chat_res.status_code == 201
    chat_id = chat_res.json()["id"]
    assert chat_res.json()["title"] == "New Chat"

    # Send message -> saves user + assistant messages & auto-generates title
    mock_qa = {
        "foundInMaterial": True,
        "answer": "Chlorophyll absorbs red and blue light inside chloroplasts.",
        "examples": ["Green leaves reflect green wavelengths."],
        "supportingQuote": "Chlorophyll pigments absorb red and blue wavelengths",
        "cached": False,
    }
    with patch("app.services.learning_service.answer_learning_question", return_value=mock_qa):
        msg_res = client.post(
            f"/api/chats/{chat_id}/messages",
            headers=headers_a,
            json={"content": "Which wavelengths does chlorophyll absorb?"},
        )
    assert msg_res.status_code == 201
    msg_body = msg_res.json()
    assert msg_body["conversation"]["title"] == "Which wavelengths does chlorophyll absorb?"
    assert msg_body["userMessage"]["role"] == "user"
    assert msg_body["assistantMessage"]["role"] == "assistant"
    assert msg_body["assistantMessage"]["foundInMaterial"] is True

    # Reload chat detail -> both messages persisted in chronological order
    detail_res = client.get(f"/api/chats/{chat_id}", headers=headers_a)
    assert detail_res.status_code == 200
    messages = detail_res.json()["messages"]
    assert len(messages) == 2
    assert messages[0]["role"] == "user"
    assert messages[1]["role"] == "assistant"
    assert "Chlorophyll absorbs red and blue" in messages[1]["content"]

    # Cross-user isolation: Bob cannot read, message, rename, or delete Alice's chat
    assert client.get(f"/api/chats/{chat_id}", headers=headers_b).status_code == 404
    assert client.post(f"/api/chats/{chat_id}/messages", headers=headers_b, json={"content": "Hi"}).status_code == 404
    assert client.patch(f"/api/chats/{chat_id}", headers=headers_b, json={"title": "Hacked"}).status_code == 404
    assert client.delete(f"/api/chats/{chat_id}", headers=headers_b).status_code == 404

    # Rename chat
    rename_res = client.patch(
        f"/api/chats/{chat_id}",
        headers=headers_a,
        json={"title": "Biology Light Absorption Study"},
    )
    assert rename_res.status_code == 200
    assert rename_res.json()["title"] == "Biology Light Absorption Study"

    # Search history finds conversation by message content and title
    search_res = client.get("/api/history/search?q=chlorophyll", headers=headers_a)
    assert search_res.status_code == 200
    assert len(search_res.json()["conversations"]) == 1
    assert len(search_res.json()["documents"]) == 1

    # Bob's search returns nothing
    bob_search = client.get("/api/history/search?q=chlorophyll", headers=headers_b)
    assert bob_search.status_code == 200
    assert bob_search.json()["conversations"] == []

    # Delete chat cascades cleanly
    del_res = client.delete(f"/api/chats/{chat_id}", headers=headers_a)
    assert del_res.status_code == 204
    assert client.get("/api/chats", headers=headers_a).json()["conversations"] == []


def test_learning_results_auto_save_manual_crud_and_ai_routes(client_and_db):
    client = client_and_db
    headers_a, _ = _register_and_headers(client, "Alice", "alice@example.edu")
    headers_b, _ = _register_and_headers(client, "Bob", "bob@example.edu")

    mock_simplify = {
        "simplifiedText": "Plants use sunlight to make their own food.",
        "difficultConcepts": [{"term": "Photosynthesis", "explanation": "Making food using light."}],
        "examples": ["Like solar panels charging a battery."],
        "readingLevel": "Beginner",
        "cached": False,
    }
    with patch("app.services.learning_service.simplify_educational_text", return_value=mock_simplify):
        res_simp = client.post(
            "/api/simplify",
            headers=headers_a,
            json={
                "text": "Photosynthesis is the biochemical process by which plants convert solar energy.",
                "readingLevel": "Beginner",
            },
        )
    assert res_simp.status_code == 200
    assert "savedResultId" in res_simp.json()

    mock_summary = {
        "summaryText": "Plants convert light into stored sugar energy.",
        "keywords": ["photosynthesis", "chloroplast", "ATP"],
        "bulletPoints": ["Chlorophyll absorbs light.", "ATP powers sugar synthesis."],
        "keyConcepts": [{"term": "Chloroplast", "definition": "Cell organelle where photosynthesis occurs."}],
        "summaryLength": "Short",
        "cached": False,
    }
    with patch("app.services.learning_service.summarize_educational_text", return_value=mock_summary):
        res_sum = client.post(
            "/api/summarize",
            headers=headers_a,
            json={
                "text": "Photosynthesis occurs inside chloroplasts where chlorophyll captures light.",
                "summaryLength": "Short",
            },
        )
    assert res_sum.status_code == 200
    sum_id = res_sum.json()["savedResultId"]

    # Manual save learning result
    res_manual = client.post(
        "/api/learning-results",
        headers=headers_a,
        json={
            "resultType": "explanation",
            "title": "Mitochondria Overview",
            "sourceExcerpt": "Mitochondria produce ATP.",
            "contentText": "Mitochondria act like power plants inside cells.",
            "examples": ["Like a rechargeable battery pack."],
        },
    )
    assert res_manual.status_code == 201

    # List & filter learning results
    all_results = client.get("/api/learning-results", headers=headers_a).json()["results"]
    assert len(all_results) == 3

    only_summaries = client.get("/api/learning-results?type=summary", headers=headers_a).json()["results"]
    assert len(only_summaries) == 1
    assert only_summaries[0]["keywords"] == ["photosynthesis", "chloroplast", "ATP"]

    # Unified history overview
    overview = client.get("/api/history", headers=headers_a).json()
    assert len(overview["learningResults"]) == 3

    # Bob cannot delete Alice's learning result
    assert client.delete(f"/api/learning-results/{sum_id}", headers=headers_b).status_code == 404
    assert client.delete(f"/api/learning-results/{sum_id}", headers=headers_a).status_code == 204


def test_assistant_and_speech_endpoints_authenticated(client_and_db):
    client = client_and_db
    headers, _ = _register_and_headers(client, "Alice", "alice@example.edu")

    mock_qa = {
        "foundInMaterial": True,
        "answer": "Chlorophyll absorbs red and blue light.",
        "examples": ["Green leaves reflect green light."],
        "supportingQuote": "chlorophyll pigments absorb photons",
        "cached": False,
    }
    with patch("app.services.learning_service.answer_learning_question", return_value=mock_qa):
        res_ok = client.post(
            "/api/assistant",
            headers=headers,
            json={
                "text": "Within chloroplasts, chlorophyll pigments absorb photons predominantly in red and blue wavelengths.",
                "question": "Which wavelengths does chlorophyll absorb?",
            },
        )
    assert res_ok.status_code == 200
    assert res_ok.json()["foundInMaterial"] is True

    long_text = "Photosynthesis converts solar light into chemical energy. " * 60
    chunks = split_text_into_speech_chunks(long_text, chunk_limit=500)
    assert len(chunks) > 5
    assert all(len(c) <= 500 for c in chunks)

    with patch(
        "app.services.learning_service.generate_speech_mp3",
        return_value=(b"ID3fake-mp3-bytes", 2, False),
    ):
        res_speech = client.post(
            "/api/speech",
            headers=headers,
            json={"text": "Photosynthesis converts solar energy into sugar.", "lang": "en", "slow": False},
        )
    assert res_speech.status_code == 200
    assert res_speech.headers["content-type"].startswith("audio/mpeg")
    assert res_speech.content == b"ID3fake-mp3-bytes"


def test_normalize_page_text_preserves_structure():
    raw = "CHAPTER 1\n\nCells are the funda-\nmental units of life.\n- Plant cells have walls"
    cleaned = normalize_page_text(raw)
    assert "CHAPTER 1" in cleaned
    assert "fundamental units of life." in cleaned
    assert "- Plant cells have walls" in cleaned


def test_youtube_recommendations_auth_validation_persistence_and_isolation(client_and_db):
    from app.services.youtube_service import (
        YouTubeServiceError,
        parse_iso8601_duration,
        score_and_filter_candidates,
    )

    # Pure helper assertions
    assert parse_iso8601_duration("PT12M5S") == "12:05"
    assert parse_iso8601_duration("PT1H02M09S") == "1:02:09"
    assert parse_iso8601_duration("PT45S") == "0:45"

    ranked = score_and_filter_candidates(
        [
            {
                "videoId": "short_1",
                "title": "Photosynthesis #shorts quick meme",
                "channelName": "MemeClips",
                "description": "#shorts viral clip",
                "thumbnailUrl": "https://img.example/1.jpg",
                "videoUrl": "https://www.youtube.com/watch?v=short_1",
                "durationSeconds": 30,
                "duration": "0:30",
                "viewCount": 500000,
                "baseReason": "Quick clip",
            },
            {
                "videoId": "edu_1",
                "title": "Photosynthesis Explained Step by Step Tutorial",
                "channelName": "Khan Biology Lab",
                "description": "Beginner friendly lesson covering chloroplast light reactions.",
                "thumbnailUrl": "https://img.example/2.jpg",
                "videoUrl": "https://www.youtube.com/watch?v=edu_1",
                "durationSeconds": 480,
                "duration": "8:00",
                "viewCount": 120000,
                "baseReason": "Clear step-by-step chloroplast explanation.",
            },
        ],
        "Photosynthesis",
        ["photosynthesis", "chloroplast"],
        "Beginner",
    )
    assert len(ranked) == 1
    assert ranked[0]["videoId"] == "edu_1"

    client = client_and_db

    # Unauthenticated access rejected
    assert (
        client.post(
            "/api/recommendations/youtube",
            json={"customTopic": "Photosynthesis", "learningLevel": "Beginner"},
        ).status_code
        == 401
    )
    assert client.get("/api/recommendations/youtube/history").status_code == 401

    headers_a, _ = _register_and_headers(client, "Alice", "alice@example.edu")
    headers_b, _ = _register_and_headers(client, "Bob", "bob@example.edu")

    # Empty topic and content returns 400
    empty_res = client.post(
        "/api/recommendations/youtube",
        headers=headers_a,
        json={"content": "", "customTopic": "", "learningLevel": "Beginner"},
    )
    assert empty_res.status_code == 400

    # Missing YouTube API key propagates clean 503 message
    with patch(
        "app.routes.recommendations.generate_youtube_recommendations",
        side_effect=YouTubeServiceError("YouTube Data API key is not configured.", 503),
    ):
        missing_key_res = client.post(
            "/api/recommendations/youtube",
            headers=headers_a,
            json={"customTopic": "Photosynthesis", "learningLevel": "Beginner"},
        )
    assert missing_key_res.status_code == 503
    assert "YouTube Data API key" in missing_key_res.json()["detail"]

    # Successful recommendation persists to DB & appears in history
    mock_analysis = {
        "topic": "Photosynthesis",
        "keywords": ["photosynthesis", "chloroplast", "ATP"],
        "searchQuery": "Photosynthesis beginner tutorial explained",
    }
    mock_candidates = [
        {
            "videoId": "edu_1",
            "title": "Photosynthesis Explained Step by Step",
            "channelName": "Khan Biology Lab",
            "description": "Beginner friendly explanation of photosynthesis and chloroplast reactions.",
            "thumbnailUrl": "https://img.example/2.jpg",
            "durationIso": "PT8M0S",
            "viewCount": 120000,
            "categoryId": "27",
        }
    ]

    with (
        patch("app.services.youtube_service.get_settings") as mock_settings,
        patch(
            "app.services.youtube_service._analyze_topic_with_gemini",
            return_value=mock_analysis,
        ),
        patch(
            "app.services.youtube_service._fetch_youtube_candidates",
            return_value=mock_candidates,
        ),
    ):
        mock_settings.return_value.youtube_api_key = "test-yt-key"
        ok_res = client.post(
            "/api/recommendations/youtube",
            headers=headers_a,
            json={
                "customTopic": "Photosynthesis",
                "learningLevel": "Beginner",
                "preferredLanguage": "English",
                "sourceType": "custom",
            },
        )
    assert ok_res.status_code == 200
    assert ok_res.headers["content-type"].startswith("application/json")
    body = ok_res.json()
    rec_id = body["id"]
    assert body["topic"] == "Photosynthesis"
    assert len(body["videos"]) == 1

    # Alice sees 1 saved video recommendation set; Bob sees 0
    hist_a = client.get("/api/recommendations/youtube/history", headers=headers_a)
    assert hist_a.status_code == 200
    assert len(hist_a.json()["recommendations"]) == 1
    assert hist_a.json()["recommendations"][0]["id"] == rec_id

    hist_b = client.get("/api/recommendations/youtube/history", headers=headers_b)
    assert hist_b.status_code == 200
    assert hist_b.json()["recommendations"] == []

    # Unified history and search include videoRecommendations
    overview_a = client.get("/api/history", headers=headers_a).json()
    assert len(overview_a["videoRecommendations"]) == 1

    search_a = client.get("/api/history/search?q=Photosynthesis", headers=headers_a).json()
    assert len(search_a["videoRecommendations"]) == 1

    # Bob cannot delete Alice's saved video set
    assert client.delete(f"/api/recommendations/youtube/{rec_id}", headers=headers_b).status_code == 404
    assert client.delete(f"/api/recommendations/youtube/{rec_id}", headers=headers_a).status_code == 204
    assert client.get("/api/recommendations/youtube/history", headers=headers_a).json()["recommendations"] == []

