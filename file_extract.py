# Future: add .mp3/.mp4 dispatchers once audio/video transcription is in scope.
import base64
import os

import docx


MIN_TEXT_LEN = 50
MAX_PDF_BYTES = 20 * 1024 * 1024  # Gemini inline_data cap


def extract_source_parts(fs):
    """Return a list of Gemini request 'parts' describing the uploaded file.

    .docx: extract text locally.
    .pdf: pass raw bytes so Gemini's vision model can read scanned PDFs too.
    """
    filename = (getattr(fs, "filename", "") or "").strip()
    if not filename:
        raise ValueError("No file uploaded.")

    ext = os.path.splitext(filename)[1].lower()
    if ext == ".docx":
        text = _extract_docx(fs).strip()
        if len(text) < MIN_TEXT_LEN:
            raise ValueError(
                "This .docx looks empty or has no readable text. "
                "Try a different file or export to PDF."
            )
        return [{"text": f"Source document:\n{text}"}]

    if ext == ".pdf":
        fs.stream.seek(0)
        data = fs.stream.read()
        if not data:
            raise ValueError("This PDF is empty.")
        if len(data) > MAX_PDF_BYTES:
            mb = len(data) // 1024 // 1024
            cap = MAX_PDF_BYTES // 1024 // 1024
            raise ValueError(
                f"PDF is too large ({mb} MB). The upload cap is {cap} MB — "
                "split the PDF or export a smaller version."
            )
        b64 = base64.b64encode(data).decode("ascii")
        return [
            {"text": "Source document attached as PDF — read it for the NC / audit details:"},
            {"inline_data": {"mime_type": "application/pdf", "data": b64}},
        ]

    raise ValueError("Upload a .docx or .pdf file.")


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
