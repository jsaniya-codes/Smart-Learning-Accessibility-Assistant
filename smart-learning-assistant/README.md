# Smart Learning Accessibility Assistant

An AI-powered Python & Streamlit web application designed to make educational content easier to read, understand, and listen to for all learners.

## Features

- **Smart PDF & TXT Upload**: Extracts text from multi-page PDF documents and `.txt` files while preserving headings, bullets, and paragraph structure, and detects scanned/image-only pages that require OCR.
- **Advanced AI Text Simplification**: Uses the official Google Gen AI SDK (`google-genai`) with selectable **Beginner**, **Intermediate**, and **Advanced** explanation levels to simplify complex passages, define technical terms, and give real-world examples.
- **Intelligent Summarization**: Generates **Short**, **Medium**, and **Detailed** summaries strictly grounded in your source text, with extracted keywords, bullet-point takeaways, and concept definitions.
- **AI Learning Assistant (Q&A)**: Interactive Q&A chat where students ask questions and receive simple, example-backed answers grounded strictly in the uploaded material (clearly flagging when an answer is not in the document).
- **Long-Text Text-to-Speech (MP3)**: Splits lengthy educational passages along sentence boundaries and synthesizes combined `.mp3` audio with in-app playback and offline download via `gTTS`.
- **Accessibility & Performance**: Adjustable font size (`14px`–`28px`), line spacing, reading-friendly and dyslexia-friendly fonts, **High-Contrast Mode**, automatic retry handling, and `@st.cache_data` response caching.

## Project Structure

```text
smart-learning-assistant/
├── app.py
├── requirements.txt
├── .gitignore
├── README.md
├── .streamlit/
│   └── config.toml
└── utils/
    ├── __init__.py
    ├── gemini_service.py
    ├── speech_service.py
    └── pdf_service.py
```

## Quick Start (Windows)

1. Create and activate a virtual environment:
   ```powershell
   python -m venv venv
   venv\Scripts\activate
   ```
2. Install dependencies:
   ```powershell
   pip install -r requirements.txt
   ```
3. Set your Gemini API key in a local `.env` file (never commit `.env`):
   ```text
   GEMINI_API_KEY=your_google_ai_studio_key_here
   GEMINI_MODEL=gemini-2.5-flash
   ```
4. Launch the application:
   ```powershell
   streamlit run app.py
   ```

## Deployment on Streamlit Community Cloud

Push this repository to GitHub (excluding `.env` and `.streamlit/secrets.toml`), connect the repository in [Streamlit Community Cloud](https://share.streamlit.io/), set the main file path to `app.py`, and add your `GEMINI_API_KEY` in **App Settings → Secrets**:

```toml
GEMINI_API_KEY = "your_google_ai_studio_key_here"
GEMINI_MODEL = "gemini-2.5-flash"
```
