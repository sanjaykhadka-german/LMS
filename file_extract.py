# Future: add .mp3/.mp4 dispatchers once audio/video transcription is in scope.
import os

import docx
import pypdf


MIN_TEXT_LEN = 50


def extract_text(fs):
    filename = (getattr(fs, "filename", "") or "").strip()
    if not filename:
        raise ValueError("No file uploaded.")

    ext = os.path.splitext(filename)[1].lower()
    if ext == ".docx":
        text = _extract_docx(fs)
    elif ext == ".pdf":
        text = _extract_pdf(fs)
    else:
        raise ValueError("Upload a .docx or .pdf file.")

    text = text.strip()
    if len(text) < MIN_TEXT_LEN:
        raise ValueError(
            "Couldn't read text from this file — it may be a scanned image. "
            "Try exporting it as a text-based PDF or a .docx."
        )
    return text


def _extract_docx(fs):
    fs.stream.seek(0)
    doc = docx.Document(fs.stream)
    lines = [p.text for p in doc.paragraphs if p.text and p.text.strip()]
    for table in doc.tables:
        for row in table.rows:
            cells = [c.text.strip() for c in row.cells if c.text and c.text.strip()]
            if cells:
                lines.append(" | ".join(cells))
    return "\n".join(lines)


def _extract_pdf(fs):
    fs.stream.seek(0)
    reader = pypdf.PdfReader(fs.stream)
    chunks = []
    for page in reader.pages:
        try:
            t = page.extract_text() or ""
        except Exception:
            t = ""
        if t.strip():
            chunks.append(t)
    return "\n".join(chunks)
