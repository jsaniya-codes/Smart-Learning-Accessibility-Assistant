# Smart Learning Accessibility Assistant

An AI-powered full-stack educational accessibility application designed to make textbooks, PDFs, lecture notes, and study topics easier to read, understand, listen to, and learn visually.

---

## Core Features

1. **PDF & TXT Document Extraction & Storage** — Extracts text from multi-page PDFs and plain text files on the backend, detects scanned pages requiring OCR, and saves uploaded files to your account.
2. **Text Simplification** — Rewrites complex passages at **Beginner**, **Intermediate**, or **Advanced** levels using Google Gemini while preserving core meaning and explaining difficult terms.
3. **Structured Text Summarization** — Generates **Short**, **Medium**, or **Detailed** summaries with bullet points, key concepts, and essential keywords.
4. **Persistent AI Learning Assistant** — Grounded study chat that answers questions strictly from your active study material and saves full conversation history per user account.
5. **YouTube Learning Video Recommendations** — Discovers and ranks up to **5** educational YouTube tutorials, visual explanations, and demonstrations based on entered text, uploaded PDF/TXT documents, generated summaries, assistant Q&A, or a custom topic search—with learning level & language filters, duration formatting, recommendation explanations, and persistent chat/library history.
6. **Accessible Text-to-Speech & Reading Controls** — Synthesizes clear downloadable audio plus live typography controls (font size, line spacing, Atkinson Hyperlegible / Lexend dyslexia-friendly fonts, and High Contrast mode).

---

## Environment Variables Setup

Copy `.env.example` to `.env` (or configure secrets in your hosting environment):

```env
GEMINI_API_KEY="MY_GEMINI_API_KEY"
GEMINI_MODEL="gemini-4-hydrogen"
YOUTUBE_API_KEY="MY_YOUTUBE_DATA_API_V3_KEY"
APP_URL="MY_APP_URL"
```

> **Security Note:** `GEMINI_API_KEY` and `YOUTUBE_API_KEY` are strictly server-side environment variables. Never place API keys in `VITE_*` variables or frontend source files.

---

## How to Obtain & Configure a YouTube Data API v3 Key

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project or select an existing project.
3. Navigate to **APIs & Services → Library**.
4. Search for **YouTube Data API v3** and click **Enable**.
5. Navigate to **APIs & Services → Credentials**.
6. Click **+ Create Credentials → API key**.
7. Copy the generated key and click **Edit API key** (recommended):
   - Under **API restrictions**, select **Restrict key** and choose **YouTube Data API v3**.
   - Avoid adding HTTP referrer restrictions if the key is called solely from your Node/Python backend server.
8. Add the key to your server environment as:
   ```env
   YOUTUBE_API_KEY="AIza..."
   ```
9. Restart the backend server so the new environment variable is picked up.

---

## Running Locally & Testing

### Start the Full-Stack App

```bash
npm install
npm run dev
```

The app runs on `http://localhost:3000`.

### Run Unit Tests

```bash
npx --yes tsx --test server/auth.test.ts server/db.test.ts server/youtube.test.ts src/utils/textMetrics.test.ts
```

### Test `POST /api/recommendations/youtube` Locally

1. Register or sign in to obtain a JWT `accessToken`:

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"fullName":"Test Student","email":"student@example.com","password":"Password123!"}' \
  | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(d.accessToken);")
```

2. Request video recommendations from study text, a document, a summary, an assistant chat, or a custom topic:

```bash
curl -s -X POST http://localhost:3000/api/recommendations/youtube \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "content": "Photosynthesis converts light energy into chemical energy stored in glucose inside chloroplasts.",
    "learningLevel": "Beginner",
    "preferredLanguage": "English",
    "sourceType": "text"
  }' | python3 -m json.tool
```

3. Retrieve saved video recommendation history for the authenticated user:

```bash
curl -s http://localhost:3000/api/recommendations/youtube/history \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

---

## Standalone Python FastAPI + React Project Folder

A standalone GitHub-ready FastAPI + SQLAlchemy + React structure is also maintained in `/Smart-Learning-Accessibility-Assistant/`. See `/Smart-Learning-Accessibility-Assistant/README.md` for FastAPI, PostgreSQL/SQLite, and Alembic migration setup instructions.
