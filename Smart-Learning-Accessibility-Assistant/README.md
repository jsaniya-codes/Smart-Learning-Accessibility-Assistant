# Smart Learning Accessibility Assistant

An AI-powered full-stack educational accessibility web application built with **React (JavaScript + Tailwind CSS)** on the frontend and **Python FastAPI + SQLAlchemy + Alembic + Google Gemini + gTTS + pypdf** on the backend.

Every student has a dedicated account with **persistent chat history**, **database-backed PDF/TXT document storage**, and a **saved library** of simplified explanations, structured summaries, and keywords that persist across sessions, logouts, and devices.

---

## Architecture Audit & Evolution

| Area | Original Architecture | Upgraded Full-Stack Persistent Architecture |
| --- | --- | --- |
| **Authentication & Identity** | Stateless anonymous browser session | **Argon2id** password hashing + **JWT (HS256)** access tokens + protected `/api/*` routes |
| **Chat History** | Ephemeral React state (`qaHistory`) | **ChatGPT-style persistent conversations** stored in `conversations` & `messages` tables (`SQLite` locally / `PostgreSQL` in production) |
| **Chat Management** | Append-only local array | Create chat, open/continue past chats, **auto-generated titles**, inline rename (`PATCH`), delete (`DELETE`), and full-text search |
| **Uploaded Documents** | Ephemeral upload extraction | Saved permanently in `documents` table (extracted text, metadata, and original PDF/TXT bytes in `LargeBinary`/`BYTEA`) with reopen, download & delete |
| **Learning Results** | Lost on page refresh | Automatically persisted to `learning_results` (`simplified`, `summary`, `explanation`) with filtering and workspace reopening |
| **Security** | Open endpoints | Strict **JWT-derived `current_user.id`** on every request; cross-user ownership checks (`404`) on every read, update, download, and delete |

---

## Project Structure

```text
Smart-Learning-Accessibility-Assistant/
├── frontend/
│   ├── index.html
│   ├── package.json
│   └── src/
│       ├── App.jsx
│       ├── main.jsx
│       ├── index.css
│       ├── components/
│       │   ├── AccessibleReaderBox.jsx
│       │   ├── ReadingToolbar.jsx
│       │   ├── SidebarNav.jsx          # + New Chat, conversation search, rename/delete, profile & Sign Out
│       │   └── VideoRecommendationsSection.jsx # Recommended Learning Videos cards & topic search
│       ├── pages/
│       │   ├── AuthPage.jsx            # Sign In / Create Account with Argon2+JWT backend auth
│       │   ├── InputPage.jsx           # PDF/TXT upload + Saved Documents manager (Reopen/Download/Delete)
│       │   ├── SimplifyPage.jsx        # Beginner / Intermediate / Advanced + auto-save to library
│       │   ├── SummarizePage.jsx       # Short / Medium / Detailed + keywords/bullets + auto-save
│       │   ├── AssistantPage.jsx       # ChatGPT-style persistent grounded conversation UI
│       │   ├── SpeechPage.jsx          # MP3 playback & offline download via gTTS
│       │   └── HistoryPage.jsx         # Unified Saved Library & full-text search across chats/docs/results/videos
│       ├── services/
│       │   └── api.js                  # Bearer JWT client (stores token only; zero local DB)
│       ├── data/
│       │   └── samplePassages.js
│       └── utils/
│           └── accessibility.js
│
├── backend/
│   ├── alembic.ini
│   ├── alembic/
│   │   ├── env.py
│   │   ├── script.py.mako
│   │   └── versions/
│   │       ├── 0001_initial_schema.py  # Initial PostgreSQL / SQLite schema migration
│   │       └── 0002_video_recommendations.py # Persistent video recommendations table
│   ├── app/
│   │   ├── main.py                     # FastAPI entry point, CORS, routers
│   │   ├── config.py                   # Pydantic Settings (.env, DATABASE_URL, JWT_SECRET_KEY, YOUTUBE_API_KEY)
│   │   ├── database.py                 # SQLAlchemy 2.0 engine, SQLite FK pragma, SessionLocal, get_db
│   │   ├── models.py                   # User, Document, Conversation, Message, LearningResult, VideoRecommendation
│   │   ├── routes/
│   │   │   ├── auth.py                 # /api/auth/register, login, logout, me
│   │   │   ├── chats.py                # /api/chats CRUD + /messages
│   │   │   ├── history.py              # /api/history & /api/history/search
│   │   │   ├── learning_results.py     # /api/learning-results CRUD
│   │   │   ├── recommendations.py      # /api/recommendations/youtube + history CRUD
│   │   │   ├── documents.py            # /api/documents upload, list, get, download, delete, analyze
│   │   │   ├── simplify.py             # /api/simplify (JWT protected + auto-save)
│   │   │   ├── summarize.py            # /api/summarize (JWT protected + auto-save)
│   │   │   ├── assistant.py            # /api/assistant (JWT protected)
│   │   │   └── speech.py               # /api/speech (JWT protected)
│   │   └── services/
│   │       ├── auth_service.py         # Argon2id password hashing + PyJWT verification
│   │       ├── chat_service.py         # Conversation CRUD, auto-titles, search
│   │       ├── learning_service.py     # Document/Result persistence + AI/speech orchestration
│   │       ├── youtube_service.py      # Gemini topic extraction + YouTube Data API v3 search & ranking
│   │       ├── gemini_service.py       # Google Gemini prompts & structured JSON
│   │       ├── pdf_service.py          # pypdf text extraction + scanned OCR detection
│   │       └── speech_service.py       # Sentence-aligned gTTS MP3 synthesis
│   ├── tests/
│   │   └── test_api.py                 # Isolated SQLite pytest suite (auth, isolation, CRUD, speech)
│   ├── requirements.txt
│   └── .env.example
│
├── .gitignore
├── LICENSE
└── README.md
```

---

## Database Schema (SQLAlchemy + Alembic)

All relationships use cascading deletes (`ondelete="CASCADE"`) or safe detaches (`ondelete="SET NULL"`) so deleting a user or conversation leaves zero orphaned records:

- **`users`**: `id` (UUID PK), `full_name`, `email` (unique indexed), `password_hash` (Argon2id), `created_at`, `updated_at`
- **`documents`**: `id` (UUID PK), `user_id` (FK -> `users.id`), `original_filename`, `file_type` (`PDF`|`TXT`), `file_size_bytes`, `content_type`, `processing_status`, `page_count`, `pages_with_text`, `ocr_warning`, `word_count`, `char_count`, `estimated_minutes`, `extracted_text`, `file_content` (`LargeBinary` / PostgreSQL `BYTEA` so original files survive ephemeral container restarts), `created_at`
- **`conversations`**: `id` (UUID PK), `user_id` (FK -> `users.id`), `document_id` (nullable FK -> `documents.id`), `title`, `created_at`, `updated_at`
- **`messages`**: `id` (UUID PK), `conversation_id` (FK -> `conversations.id`), `role` (`user`|`assistant`), `content`, `found_in_material`, `examples_json`, `supporting_quote`, `created_at`
- **`learning_results`**: `id` (UUID PK), `user_id` (FK -> `users.id`), `document_id` (nullable FK -> `documents.id`), `result_type` (`simplified`|`summary`|`explanation`), `title`, `source_excerpt`, `reading_level`, `summary_length`, `content_text`, `keywords_json`, `bullet_points_json`, `concepts_json`, `examples_json`, `created_at`
- **`video_recommendations`**: `id` (UUID PK), `user_id` (FK -> `users.id`), `document_id` (nullable FK -> `documents.id`), `conversation_id` (nullable FK -> `conversations.id`), `source_type`, `topic`, `keywords_json`, `learning_level`, `preferred_language`, `search_query`, `videos_json`, `created_at`

---

## Backend API Endpoints

### Authentication (`/api/auth`)
- `POST /api/auth/register` — Register unique account, return JWT `accessToken` + `user`
- `POST /api/auth/login` — Verify Argon2 password hash, return JWT `accessToken` + `user`
- `POST /api/auth/logout` — Authenticated sign-out acknowledgment
- `GET /api/auth/me` — Return currently authenticated user profile

### Persistent Chats (`/api/chats`) & History (`/api/history`)
- `POST /api/chats` — Create a new conversation (optionally linked to a `documentId`)
- `GET /api/chats?q=` — List user's conversations ordered by `updated_at` desc (supports title/message search)
- `GET /api/chats/{chat_id}` — Fetch conversation details, linked document, and ordered messages
- `POST /api/chats/{chat_id}/messages` — Save user message, run grounded Gemini Q&A, save assistant reply, auto-title new chats
- `PATCH /api/chats/{chat_id}` — Rename a conversation
- `DELETE /api/chats/{chat_id}` — Delete conversation and cascade messages
- `GET /api/history` — Unified overview of conversations, documents, and saved learning results
- `GET /api/history/search?q=` — Search across chats, messages, documents, and learning results

### Documents (`/api/documents`) — All JWT Protected
- `POST /api/documents/upload` — Validate & extract PDF/TXT, persist metadata, text, and binary file bytes
- `GET /api/documents` — List uploaded documents for the logged-in user
- `GET /api/documents/{document_id}` — Reopen document metadata and extracted text
- `GET /api/documents/{document_id}/download` — Download original uploaded file bytes
- `DELETE /api/documents/{document_id}` — Delete document
- `POST /api/documents/analyze` — Compute word count, character count, and reading time

### Saved Learning Results (`/api/learning-results`) & AI/Speech — All JWT Protected
- `GET /api/learning-results?type=` — List saved `simplified`, `summary`, or `explanation` items
- `POST /api/learning-results` — Explicitly save an AI explanation or study note
- `DELETE /api/learning-results/{result_id}` — Delete saved result
- `POST /api/simplify` — Simplify text (`Beginner`, `Intermediate`, `Advanced`) and auto-save to `learning_results`
- `POST /api/summarize` — Summarize text (`Short`, `Medium`, `Detailed`) with keywords, bullets, concepts, and auto-save
- `POST /api/assistant` — Grounded single-turn Q&A endpoint
- `POST /api/speech` — Synthesize MP3 audio via `gTTS`
- `POST /api/recommendations/youtube` — Extract topic & keywords, query YouTube Data API v3, rank up to 5 educational videos, and persist results
- `GET /api/recommendations/youtube/history` — List saved video recommendation sets for the logged-in user
- `DELETE /api/recommendations/youtube/{recommendation_id}` — Delete a saved video recommendation set

---

## Local Development & Migrations

### 1. Backend Setup (Python 3.10+)

```bash
cd Smart-Learning-Accessibility-Assistant/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Edit `.env` with your keys (never expose `GEMINI_API_KEY` or `YOUTUBE_API_KEY` in frontend code):

```env
GEMINI_API_KEY="your_google_gemini_api_key"
YOUTUBE_API_KEY="your_youtube_data_api_v3_key"
JWT_SECRET_KEY="replace_with_a_long_random_secret_string"
DATABASE_URL="sqlite:///./smart_learning.db"
ALLOWED_ORIGINS="http://localhost:5173,http://127.0.0.1:5173"
```

#### Obtaining a YouTube Data API v3 Key
1. Open Google Cloud Console and select or create your project.
2. Enable **YouTube Data API v3** under **APIs & Services -> Library**.
3. Create an API key under **APIs & Services -> Credentials** and paste it into `YOUTUBE_API_KEY` in `backend/.env`.

Run Alembic database migrations and launch FastAPI:

```bash
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

### 2. Frontend Setup (Node.js 18+)

```bash
cd Smart-Learning-Accessibility-Assistant/frontend
npm install
echo "VITE_API_BASE_URL=http://localhost:8000" > .env.local
npm run dev
```

Open `http://localhost:5173`.

### 3. Run Automated Backend Tests

```bash
cd Smart-Learning-Accessibility-Assistant/backend
pytest -v tests/test_api.py
```

---

## Production Deployment (Render + PostgreSQL + Vercel)

### Backend on Render (`Smart-Learning-Accessibility-Assistant/backend`)
1. Create a managed **PostgreSQL** database on Render and copy its **Internal Database URL**.
2. Create a **Web Service** pointing to `Smart-Learning-Accessibility-Assistant/backend`:
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT`
3. Configure Environment Variables on Render:
   - `DATABASE_URL`: Render PostgreSQL connection string (`postgres://...` and `postgresql://...` are automatically normalized to `postgresql+psycopg://...`)
   - `GEMINI_API_KEY`: Your Gemini API key
   - `JWT_SECRET_KEY`: High-entropy 64+ char secret (`python -c "import secrets; print(secrets.token_urlsafe(48))"`)
   - `ALLOWED_ORIGINS`: Your Vercel frontend URL (e.g. `https://your-app.vercel.app`)

### Frontend on Vercel (`Smart-Learning-Accessibility-Assistant/frontend`)
1. Import repository in Vercel with Root Directory set to `Smart-Learning-Accessibility-Assistant/frontend`.
2. Framework Preset: **Vite** (`npm run build`, output directory `dist`).
3. Add Environment Variable:
   - `VITE_API_BASE_URL`: Your Render backend URL (e.g. `https://smart-learning-api.onrender.com`).

---

## License

MIT License — see [LICENSE](./LICENSE).
