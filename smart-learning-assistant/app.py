"""Smart Learning Accessibility Assistant — Upgraded Streamlit Application."""

import hashlib
import html
import streamlit as st

from utils import (
    DocumentExtractionError,
    GeminiServiceError,
    SpeechGenerationError,
    cached_answer_learning_question,
    cached_generate_speech_mp3,
    cached_simplify_educational_text,
    cached_summarize_educational_text,
    extract_text_from_upload,
    get_configured_model,
)

SAMPLE_TEXT = (
    "Photosynthesis is the biochemical process by which photoautotrophic organisms, "
    "including vascular plants, algae, and cyanobacteria, transduce electromagnetic "
    "solar radiation into chemical potential energy stored in carbohydrate molecules. "
    "Within specialized organelles known as chloroplasts, chlorophyll pigments absorb "
    "photons predominantly in the red and blue wavelengths, initiating light-dependent "
    "reactions across the thylakoid membranes that synthesize adenosine triphosphate (ATP) "
    "and nicotinamide adenine dinucleotide phosphate (NADPH). Subsequently, the Calvin "
    "cycle utilizes these energetic intermediates in the stroma to fix atmospheric "
    "carbon dioxide into triose phosphates, releasing molecular oxygen as an essential "
    "byproduct that sustains aerobic life on Earth."
)

FONT_MAP = {
    "Standard Sans (Plus Jakarta Sans)": "'Plus Jakarta Sans', 'Segoe UI', sans-serif",
    "Reading Friendly (Atkinson Hyperlegible)": "'Atkinson Hyperlegible', 'Segoe UI', sans-serif",
    "Dyslexia Friendly (OpenDyslexic / Lexend)": "'OpenDyslexic', 'Lexend', 'Comic Sans MS', sans-serif",
}


def init_session_state() -> None:
    """Initialize persistent session state values."""
    defaults = {
        "active_page": "Input & PDF Upload",
        "source_text": "",
        "source_meta": None,
        "last_upload_digest": None,
        "font_size": 18,
        "line_height_label": "Relaxed (1.75)",
        "reading_font_label": "Reading Friendly (Atkinson Hyperlegible)",
        "high_contrast": False,
        "simplified_result": None,
        "simplified_level": "Beginner",
        "summary_result": None,
        "summary_length": "Medium",
        "audio_bytes": None,
        "audio_source_label": "",
        "qa_history": [],
    }
    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value


def _decrease_font() -> None:
    st.session_state["font_size"] = max(14, st.session_state["font_size"] - 2)


def _increase_font() -> None:
    st.session_state["font_size"] = min(28, st.session_state["font_size"] + 2)


def inject_custom_styles() -> None:
    """Apply light educational theme or high-contrast accessibility mode."""
    high_contrast = st.session_state["high_contrast"]

    if high_contrast:
        app_bg = "#090D16"
        app_fg = "#FFFFFF"
        sidebar_bg = "#111827"
        border_color = "#93C5FD"
        card_bg = "#0F172A"
        card_fg = "#FFFFFF"
        header_bg = "#111827"
        header_title = "#FDE047"
        header_sub = "#E2E8F0"
        term_fg = "#FDE047"
        btn_bg = "#FACC15"
        btn_fg = "#090D16"
        keyword_bg = "#1E293B"
        keyword_fg = "#93C5FD"
    else:
        app_bg = "#F8FAFC"
        app_fg = "#0F172A"
        sidebar_bg = "#FFFFFF"
        border_color = "#CBD5E1"
        card_bg = "#FFFFFF"
        card_fg = "#0F172A"
        header_bg = "linear-gradient(135deg, #EEF2FF 0%, #F5F3FF 100%)"
        header_title = "#1E1B4B"
        header_sub = "#475569"
        term_fg = "#5B21B6"
        btn_bg = "linear-gradient(90deg, #5B4BFF 0%, #2563EB 100%)"
        btn_fg = "#FFFFFF"
        keyword_bg = "#EEF2FF"
        keyword_fg = "#3730A3"

    st.markdown(
        f"""
        <style>
        @import url('https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Lexend:wght@400;500;600&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
        @import url('https://fonts.cdnfonts.com/css/opendyslexic');

        .stApp {{
            background-color: {app_bg};
            color: {app_fg};
            font-family: 'Plus Jakarta Sans', 'Segoe UI', sans-serif;
        }}
        section[data-testid="stSidebar"] {{
            background-color: {sidebar_bg};
            border-right: 1px solid {border_color};
        }}
        section[data-testid="stSidebar"] * {{
            color: {app_fg};
        }}
        .sla-header-card {{
            background: {header_bg};
            border: 1px solid {border_color};
            border-radius: 14px;
            padding: 20px 24px;
            margin-bottom: 18px;
        }}
        .sla-header-title {{
            color: {header_title};
            font-size: 1.55rem;
            font-weight: 700;
            margin: 0 0 6px 0;
        }}
        .sla-header-subtitle {{
            color: {header_sub};
            font-size: 0.96rem;
            margin: 0;
        }}
        .sla-reading-box {{
            background-color: {card_bg};
            border: 1.5px solid {border_color};
            border-radius: 12px;
            padding: 22px 26px;
            color: {card_fg};
            margin-bottom: 16px;
        }}
        .sla-concept-card {{
            background-color: {card_bg};
            border: 1.5px solid {border_color};
            border-radius: 10px;
            padding: 14px 18px;
            color: {card_fg};
            margin-bottom: 10px;
        }}
        .sla-concept-term {{
            color: {term_fg};
            font-weight: 700;
            margin-bottom: 4px;
        }}
        .sla-keyword-chip {{
            display: inline-block;
            background-color: {keyword_bg};
            color: {keyword_fg};
            border: 1px solid {border_color};
            border-radius: 6px;
            padding: 4px 10px;
            margin: 0 8px 8px 0;
            font-size: 0.88rem;
            font-weight: 600;
        }}
        div.stButton > button[kind="primary"] {{
            background: {btn_bg};
            border: none;
            color: {btn_fg};
            font-weight: 700;
            border-radius: 8px;
        }}
        @media (max-width: 768px) {{
            .sla-header-card {{
                padding: 14px 16px;
            }}
            .sla-header-title {{
                font-size: 1.25rem;
            }}
            .sla-reading-box {{
                padding: 16px;
            }}
        }}
        </style>
        """,
        unsafe_allow_html=True,
    )


def _get_line_height() -> float:
    spacing_map = {
        "Standard (1.5)": 1.5,
        "Relaxed (1.75)": 1.75,
        "Wide (2.0)": 2.0,
    }
    return spacing_map.get(st.session_state["line_height_label"], 1.75)


def render_accessible_text_box(content: str) -> None:
    """Render educational content using the user's chosen accessible font, size, and spacing."""
    font_size = st.session_state["font_size"]
    line_height = _get_line_height()
    font_family = FONT_MAP.get(
        st.session_state["reading_font_label"],
        "'Plus Jakarta Sans', sans-serif",
    )
    escaped = html.escape(content).replace("\n", "<br>")
    st.markdown(
        f"""
        <div class="sla-reading-box" style="font-size: {font_size}px; line-height: {line_height}; font-family: {font_family};">
            {escaped}
        </div>
        """,
        unsafe_allow_html=True,
    )


def render_sidebar() -> str:
    """Render sidebar navigation and global accessibility controls."""
    pages = [
        "Input & PDF Upload",
        "Text Simplification",
        "Text Summarization",
        "AI Learning Assistant",
        "Text-to-Speech",
    ]
    with st.sidebar:
        st.markdown("## Smart Learning")
        st.caption("Accessibility Assistant")
        st.divider()

        current_index = pages.index(st.session_state["active_page"])
        selected_page = st.radio(
            "Navigate Features",
            options=pages,
            index=current_index,
        )
        st.session_state["active_page"] = selected_page

        st.divider()
        st.subheader("Accessibility Controls")

        st.toggle("High-Contrast Mode", key="high_contrast")

        st.selectbox(
            "Reading Font",
            options=list(FONT_MAP.keys()),
            key="reading_font_label",
        )

        col_dec, col_val, col_inc = st.columns([1, 2, 1])
        with col_dec:
            st.button("A-", use_container_width=True, on_click=_decrease_font)
        with col_val:
            st.markdown(
                f"<div style='text-align:center; padding-top:6px; font-weight:700;'>{st.session_state['font_size']} px</div>",
                unsafe_allow_html=True,
            )
        with col_inc:
            st.button("A+", use_container_width=True, on_click=_increase_font)

        st.slider(
            "Font Size (px)",
            min_value=14,
            max_value=28,
            step=1,
            key="font_size",
        )

        st.selectbox(
            "Line Spacing",
            options=["Standard (1.5)", "Relaxed (1.75)", "Wide (2.0)"],
            key="line_height_label",
        )

        st.divider()
        word_count = len(st.session_state["source_text"].split())
        st.caption(f"Loaded Words: {word_count}")
        st.caption(f"Gemini Model: `{get_configured_model()}`")

    return selected_page


def _reset_derived_outputs() -> None:
    st.session_state["simplified_result"] = None
    st.session_state["summary_result"] = None
    st.session_state["audio_bytes"] = None
    st.session_state["qa_history"] = []


def render_input_page() -> None:
    """Render the Smart PDF/TXT upload and text input workspace."""
    st.subheader("1. Upload PDF / TXT Document or Enter Study Text")
    st.write(
        "Upload a text-based PDF or TXT file, paste your educational material, or load a sample passage."
    )

    col_upload, col_sample = st.columns([3, 1])
    with col_upload:
        uploaded_file = st.file_uploader(
            "Upload a PDF or TXT file",
            type=["pdf", "txt"],
            help="Preserves paragraph and heading structure for lengthy educational PDFs.",
        )
    with col_sample:
        st.write("")
        st.write("")
        if st.button("Load Sample Passage", use_container_width=True):
            st.session_state["source_text"] = SAMPLE_TEXT
            st.session_state["source_meta"] = {
                "filename": "Sample: Photosynthesis",
                "file_type": "Sample",
                "pages": 1,
                "ocr_warning": None,
            }
            st.session_state["last_upload_digest"] = None
            _reset_derived_outputs()
            st.success("Sample educational passage loaded.")

    if uploaded_file is not None:
        raw_bytes = uploaded_file.getvalue()
        file_digest = hashlib.sha256(raw_bytes).hexdigest()
        if st.session_state["last_upload_digest"] != file_digest:
            try:
                with st.spinner("Extracting document text..."):
                    extracted_text, meta = extract_text_from_upload(uploaded_file)
                st.session_state["source_text"] = extracted_text
                st.session_state["source_meta"] = meta
                st.session_state["last_upload_digest"] = file_digest
                _reset_derived_outputs()
                st.success(
                    f"Extracted text from '{meta['filename']}' ({meta['file_type']}, {meta['pages']} page(s))."
                )
            except DocumentExtractionError as exc:
                st.error(str(exc))

    meta = st.session_state.get("source_meta")
    if meta and meta.get("ocr_warning"):
        st.warning(meta["ocr_warning"])

    updated_text = st.text_area(
        "Educational Content",
        value=st.session_state["source_text"],
        height=240,
        placeholder="Paste a textbook chapter, lecture notes, or PDF excerpt here...",
    )
    if updated_text != st.session_state["source_text"]:
        st.session_state["source_text"] = updated_text
        _reset_derived_outputs()

    if st.session_state["source_text"].strip():
        q1, q2, q3, q4 = st.columns(4)
        with q1:
            if st.button("Simplify Text", use_container_width=True):
                st.session_state["active_page"] = "Text Simplification"
                st.rerun()
        with q2:
            if st.button("Summarize", use_container_width=True):
                st.session_state["active_page"] = "Text Summarization"
                st.rerun()
        with q3:
            if st.button("Ask AI Assistant", use_container_width=True):
                st.session_state["active_page"] = "AI Learning Assistant"
                st.rerun()
        with q4:
            if st.button("Listen as Audio", use_container_width=True):
                st.session_state["active_page"] = "Text-to-Speech"
                st.rerun()

        st.markdown("#### Accessible Reading Preview")
        render_accessible_text_box(st.session_state["source_text"])
    else:
        st.info("Enter text above or upload a PDF/TXT file to preview and process it.")


def render_simplification_page() -> None:
    """Render the Beginner / Intermediate / Advanced Text Simplification workspace."""
    st.subheader("2. Advanced AI Text Simplification")
    st.write(
        "Convert complicated academic language into clear English while preserving original meaning."
    )

    if not st.session_state["source_text"].strip():
        st.warning("No educational text is loaded yet. Please add text in 'Input & PDF Upload' first.")
        return

    reading_level = st.selectbox(
        "Select Explanation Level",
        options=["Beginner", "Intermediate", "Advanced"],
        index=["Beginner", "Intermediate", "Advanced"].index(
            st.session_state.get("simplified_level", "Beginner")
        ),
    )

    if st.button("Simplify Educational Content", type="primary"):
        with st.spinner(f"Simplifying at {reading_level} level with Google Gemini..."):
            try:
                result = cached_simplify_educational_text(
                    st.session_state["source_text"],
                    reading_level=reading_level,
                )
                st.session_state["simplified_result"] = result
                st.session_state["simplified_level"] = reading_level
                st.success(f"Simplified at {reading_level} level.")
            except GeminiServiceError as exc:
                st.error(str(exc))

    result = st.session_state.get("simplified_result")
    if result:
        st.markdown(
            f"#### Simplified Explanation ({st.session_state.get('simplified_level', reading_level)})"
        )
        render_accessible_text_box(result.get("simplified_text", ""))

        concepts = result.get("difficult_concepts") or []
        if concepts:
            st.markdown("#### Difficult Technical Terms Explained")
            for item in concepts:
                term = html.escape(str(item.get("term", "")))
                explanation = html.escape(str(item.get("explanation", "")))
                st.markdown(
                    f"""
                    <div class="sla-concept-card" style="font-size: {max(14, st.session_state['font_size'] - 1)}px;">
                        <div class="sla-concept-term">{term}</div>
                        <div>{explanation}</div>
                    </div>
                    """,
                    unsafe_allow_html=True,
                )

        examples = result.get("examples") or []
        if examples:
            st.markdown("#### Simple Real-World Examples")
            for idx, example in enumerate(examples, start=1):
                st.markdown(f"**Example {idx}:** {example}")


def render_summarization_page() -> None:
    """Render Short / Medium / Detailed Intelligent Summarization workspace."""
    st.subheader("3. Intelligent Text Summarization")
    st.write(
        "Generate Short, Medium, or Detailed summaries strictly grounded in your uploaded material."
    )

    if not st.session_state["source_text"].strip():
        st.warning("No educational text is loaded yet. Please add text in 'Input & PDF Upload' first.")
        return

    summary_length = st.selectbox(
        "Summary Length",
        options=["Short", "Medium", "Detailed"],
        index=["Short", "Medium", "Detailed"].index(
            st.session_state.get("summary_length", "Medium")
        ),
    )

    if st.button("Summarize Educational Content", type="primary"):
        with st.spinner(f"Generating {summary_length} summary with Google Gemini..."):
            try:
                result = cached_summarize_educational_text(
                    st.session_state["source_text"],
                    summary_length=summary_length,
                )
                st.session_state["summary_result"] = result
                st.session_state["summary_length"] = summary_length
                st.success(f"{summary_length} summary generated successfully.")
            except GeminiServiceError as exc:
                st.error(str(exc))

    result = st.session_state.get("summary_result")
    if result:
        st.markdown(
            f"#### {st.session_state.get('summary_length', summary_length)} Summary"
        )
        render_accessible_text_box(result.get("summary_text", ""))

        keywords = result.get("keywords") or []
        if keywords:
            st.markdown("#### Extracted Keywords")
            chips = "".join(
                f"<span class='sla-keyword-chip'>{html.escape(str(kw))}</span>"
                for kw in keywords
            )
            st.markdown(f"<div>{chips}</div>", unsafe_allow_html=True)

        bullets = result.get("bullet_points") or []
        if bullets:
            st.markdown("#### Important Takeaways")
            font_px = st.session_state["font_size"]
            line_h = _get_line_height()
            for point in bullets:
                st.markdown(
                    f"<div style='font-size:{font_px}px; line-height:{line_h}; margin-bottom:8px;'>• {html.escape(str(point))}</div>",
                    unsafe_allow_html=True,
                )

        concepts = result.get("key_concepts") or []
        if concepts:
            st.markdown("#### Key Definitions & Concepts")
            cols = st.columns(2)
            for idx, concept in enumerate(concepts):
                term = html.escape(str(concept.get("term", "")))
                definition = html.escape(str(concept.get("definition", "")))
                with cols[idx % 2]:
                    st.markdown(
                        f"""
                        <div class="sla-concept-card" style="font-size: {max(14, st.session_state['font_size'] - 1)}px;">
                            <div class="sla-concept-term">{term}</div>
                            <div>{definition}</div>
                        </div>
                        """,
                        unsafe_allow_html=True,
                    )


def render_assistant_page() -> None:
    """Render the grounded AI Learning Assistant Q&A workspace."""
    st.subheader("4. AI Learning Assistant (Ask About Your Material)")
    st.write(
        "Ask questions about your uploaded PDF or study text. Answers are grounded strictly in your material."
    )

    if not st.session_state["source_text"].strip():
        st.warning("No educational text is loaded yet. Please add text in 'Input & PDF Upload' first.")
        return

    with st.form("qa_form", clear_on_submit=True):
        question = st.text_input(
            "Ask a question about your uploaded material",
            placeholder="e.g., What is the main purpose of the Calvin cycle?",
        )
        submitted = st.form_submit_button("Ask Assistant", type="primary")

    if submitted:
        if not question.strip():
            st.error("Please type a question before submitting.")
        else:
            with st.spinner("Searching your study material and preparing a clear answer..."):
                try:
                    answer_data = cached_answer_learning_question(
                        st.session_state["source_text"],
                        question.strip(),
                    )
                    st.session_state["qa_history"].append(
                        {"question": question.strip(), **answer_data}
                    )
                except GeminiServiceError as exc:
                    st.error(str(exc))

    for item in reversed(st.session_state["qa_history"]):
        st.markdown(f"**Question:** {item['question']}")
        if item.get("found_in_material"):
            render_accessible_text_box(item.get("answer", ""))
            if item.get("examples"):
                st.markdown("**Examples from the material:**")
                for ex in item["examples"]:
                    st.markdown(f"- {ex}")
            if item.get("supporting_quote"):
                st.caption(f"Supporting excerpt: \"{item['supporting_quote']}\"")
        else:
            st.warning(
                "Not available in uploaded material: " + item.get("answer", "")
            )
        st.divider()


def render_speech_page() -> None:
    """Render the long-text gTTS Text-to-Speech workspace."""
    st.subheader("5. Advanced Text-to-Speech Audio Player")
    st.write(
        "Convert short or lengthy educational content into spoken English audio and download as MP3."
    )

    available_sources = {}
    if st.session_state["source_text"].strip():
        available_sources["Original Input Text"] = st.session_state["source_text"]
    if st.session_state.get("simplified_result"):
        available_sources["Simplified Text"] = st.session_state["simplified_result"].get(
            "simplified_text", ""
        )
    if st.session_state.get("summary_result"):
        available_sources["Summary Overview"] = st.session_state["summary_result"].get(
            "summary_text", ""
        )

    if not available_sources:
        st.warning("No text is available yet. Please enter text or upload a file in 'Input & PDF Upload'.")
        return

    selected_label = st.selectbox(
        "Choose Text to Convert to Speech",
        options=list(available_sources.keys()),
    )
    slow_pace = st.checkbox("Read slowly for clearer comprehension", value=False)
    text_to_speak = available_sources[selected_label]

    render_accessible_text_box(text_to_speak)

    if st.button("Generate MP3 Speech", type="primary"):
        with st.spinner("Converting text to MP3 audio (handling long passages automatically)..."):
            try:
                mp3_bytes = cached_generate_speech_mp3(
                    text_to_speak, lang="en", slow=slow_pace
                )
                st.session_state["audio_bytes"] = mp3_bytes
                st.session_state["audio_source_label"] = selected_label
                st.success("MP3 audio generated successfully.")
            except SpeechGenerationError as exc:
                st.error(str(exc))

    if st.session_state.get("audio_bytes"):
        st.markdown(f"#### Audio Playback ({st.session_state['audio_source_label']})")
        st.audio(st.session_state["audio_bytes"], format="audio/mp3")
        st.download_button(
            label="Download MP3 Audio",
            data=st.session_state["audio_bytes"],
            file_name="smart_learning_audio.mp3",
            mime="audio/mp3",
        )


def main() -> None:
    """Main entry point for the Smart Learning Accessibility Assistant."""
    st.set_page_config(
        page_title="Smart Learning Accessibility Assistant",
        page_icon="📘",
        layout="wide",
        initial_sidebar_state="expanded",
    )

    init_session_state()
    inject_custom_styles()

    st.markdown(
        """
        <div class="sla-header-card">
            <h1 class="sla-header-title">Smart Learning Accessibility Assistant</h1>
            <p class="sla-header-subtitle">
                Simplify complex study materials, summarize key concepts, ask grounded questions, customize accessibility, and listen with AI-powered speech.
            </p>
        </div>
        """,
        unsafe_allow_html=True,
    )

    active_page = render_sidebar()

    if active_page == "Input & PDF Upload":
        render_input_page()
    elif active_page == "Text Simplification":
        render_simplification_page()
    elif active_page == "Text Summarization":
        render_summarization_page()
    elif active_page == "AI Learning Assistant":
        render_assistant_page()
    elif active_page == "Text-to-Speech":
        render_speech_page()


if __name__ == "__main__":
    main()
