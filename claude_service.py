"""Claude (Anthropic) backend for the AI module studio.

Exposes the same interface as gemini_service (chat_turn,
generate_module_json) so ai_service can dispatch to either.
"""
import base64
import json
import logging
import os
import re

import requests
from flask import current_app, session

log = logging.getLogger(__name__)

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"
DEFAULT_MAX_TOKENS = 8000
DEFAULT_TIMEOUT = 180
MAX_HISTORY_TURNS = 20

# Claude input limits per content block (Anthropic Messages API)
MAX_PDF_BYTES = 32 * 1024 * 1024
MAX_IMAGE_BYTES = 5 * 1024 * 1024

_SKILL_DIR = os.path.join(os.path.dirname(__file__), "skills", "qa-quiz-creator")
_JSON_BLOCK_RE = re.compile(r"```json\s*\n(.*?)\n```\s*$", re.DOTALL)
_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*\n?(.*?)\n?```\s*$", re.DOTALL)


def _load_system_prompt():
    skill_md = os.path.join(_SKILL_DIR, "SKILL.md")
    schema_md = os.path.join(_SKILL_DIR, "references", "module-schema.md")
    with open(skill_md, "r", encoding="utf-8") as f:
        skill = f.read()
    with open(schema_md, "r", encoding="utf-8") as f:
        schema = f.read()
    return (
        skill
        + "\n\n---\n\n# Reference: module-schema.md\n\n"
        + schema
        + "\n\n---\n\n"
        + "# Chat protocol\n\n"
        + "You are in a live chat with a QA/QC author. Keep conversational replies "
        + "short (2–4 sentences). When you produce or update a training module — "
        + "which is most turns — append the **complete** module JSON at the very end "
        + "of your reply inside a fenced ```json code block. Always output the full "
        + "module every single time, never a diff or partial update. The JSON must "
        + "satisfy the importer: required top-level `title`; `sections` array with "
        + "types story / scenario / takeaway / default; `quiz.questions[]` of type "
        + "`multiple_choice` (with 0-indexed `correctAnswer`) or `true_false` (with "
        + "boolean `correctAnswer`). If the user is just chatting — asking a question, "
        + "discussing options — reply without a JSON block.\n\n"
        + "# Accepted inputs\n\n"
        + "Inputs can be any mix of: documents (NC reports, audit findings, SQF "
        + "procedures, SOPs), photos of products / labels / equipment / non-conformance "
        + "evidence, or their descriptions in text. All are valid starting points.\n\n"
        + "**Do NOT refuse.** Never respond with 'I need a text document' or 'I can't "
        + "build a module from this image.' You always can. For a product photo, pick "
        + "the most relevant German Butchery angle (labelling, handling hygiene, "
        + "storage temps, allergen control, cross-contamination, slicing safety) and "
        + "build the module. Briefly say which angle you picked at the top of your "
        + "reply. Only ask a clarifying question if the content is genuinely ambiguous "
        + "AND you still offer a default choice."
    )


SYSTEM_PROMPT = _load_system_prompt()


def _config():
    api_key = current_app.config.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise RuntimeError("Claude API key not configured (set ANTHROPIC_API_KEY)")
    model = current_app.config.get("CLAUDE_MODEL", "claude-sonnet-4-6")
    return api_key, model


# ------------------------------------------------------------------
# Content-block building
# ------------------------------------------------------------------

def can_handle(meta):
    """Return (ok: bool, reason: str|None) — called from file_extract at upload."""
    kind = meta.get("kind")
    size = meta.get("size", 0)
    if kind == "docx":
        return True, None
    if kind == "pdf":
        if size > MAX_PDF_BYTES:
            return False, (
                f"Claude accepts PDFs up to {MAX_PDF_BYTES // 1024 // 1024} MB. "
                "Split the PDF or switch to Gemini (AI_PROVIDER=gemini)."
            )
        return True, None
    if kind == "image":
        if size > MAX_IMAGE_BYTES:
            return False, (
                f"Claude accepts images up to {MAX_IMAGE_BYTES // 1024 // 1024} MB. "
                "Compress the image or switch to Gemini."
            )
        return True, None
    if kind in ("audio", "video"):
        return False, (
            f"Claude doesn't accept {kind} files. Switch to Gemini "
            "(AI_PROVIDER=gemini) or provide a transcript as PDF/DOCX."
        )
    return False, f"Claude doesn't accept this file type ({kind})."


def _build_blocks_for_file(meta):
    """Convert file metadata → Anthropic content block(s)."""
    kind = meta.get("kind")
    if kind == "docx":
        text = meta.get("extracted_text") or ""
        return [{"type": "text",
                 "text": f"[Attached .docx: {meta['filename']}]\n{text}"}]

    with open(meta["local_path"], "rb") as f:
        data = f.read()
    b64 = base64.b64encode(data).decode("ascii")

    if kind == "pdf":
        return [{
            "type": "document",
            "source": {"type": "base64",
                       "media_type": "application/pdf",
                       "data": b64},
        }]
    if kind == "image":
        return [{
            "type": "image",
            "source": {"type": "base64",
                       "media_type": meta["mime_type"],
                       "data": b64},
        }]
    raise ValueError(f"Claude can't format a {kind} file")


# ------------------------------------------------------------------
# Public API
# ------------------------------------------------------------------

def chat_turn(user_text, file_ids):
    api_key, model = _config()

    studio = session.get("ai_studio") or {"history": [], "files": {}, "current_json": ""}
    files_map = studio.get("files") or {}

    # New user turn: build content blocks
    new_user_blocks = []
    for fid in file_ids or []:
        meta = files_map.get(fid)
        if meta:
            new_user_blocks.extend(_build_blocks_for_file(meta))
    if user_text:
        new_user_blocks.append({"type": "text", "text": user_text})
    if not new_user_blocks:
        raise ValueError("Type a message or attach a file.")

    # Rebuild the conversation: only attach files on the first user turn that
    # cited them (subsequent turns rely on Claude's conversation context).
    first_file_idx = _first_file_turn_index(studio.get("history") or [])
    messages = []
    for i, turn in enumerate(studio.get("history") or []):
        role = turn.get("role")
        if role == "user":
            blocks = []
            if turn.get("file_ids") and i == first_file_idx:
                for fid in turn["file_ids"]:
                    meta = files_map.get(fid)
                    if meta:
                        blocks.extend(_build_blocks_for_file(meta))
            if turn.get("text"):
                blocks.append({"type": "text", "text": turn["text"]})
            if blocks:
                messages.append({"role": "user", "content": blocks})
        elif role in ("model", "assistant"):
            text = turn.get("text", "") or ""
            if turn.get("module_json"):
                text = text + "\n\n```json\n" + turn["module_json"] + "\n```"
            if text.strip():
                messages.append({"role": "assistant",
                                 "content": [{"type": "text", "text": text}]})
    messages.append({"role": "user", "content": new_user_blocks})

    body = {
        "model": model,
        "max_tokens": DEFAULT_MAX_TOKENS,
        "system": [{
            "type": "text",
            "text": SYSTEM_PROMPT,
            "cache_control": {"type": "ephemeral"},
        }],
        "messages": messages,
    }

    reply_text_raw = _call_claude(api_key, body)
    reply_text, module_json = _split_reply_and_json(reply_text_raw)

    history = studio.get("history") or []
    history.append({"role": "user", "text": user_text, "file_ids": list(file_ids or [])})
    history.append({"role": "assistant", "text": reply_text, "module_json": module_json})
    studio["history"] = _trim(history)
    if module_json:
        studio["current_json"] = module_json
    session["ai_studio"] = studio
    session.modified = True

    return reply_text, module_json


def generate_module_json(source_parts_or_blocks, module_id, sqf_clause):
    """Legacy single-shot entry point. Accepts either Anthropic blocks (when
    called from ai_service with Claude as provider) or Gemini parts (legacy
    callers — in which case we can't actually use them, so treat as text)."""
    api_key, model = _config()
    preamble = {
        "type": "text",
        "text": (
            f"moduleId: {module_id or '(not supplied — infer from the document)'}\n"
            f"sqfClause: {sqf_clause or '(not supplied — infer from the document)'}\n\n"
            "Build the training module now. Reply briefly, then include the full "
            "module JSON in a fenced ```json block."
        ),
    }
    content = [preamble] + [b for b in source_parts_or_blocks if isinstance(b, dict) and b.get("type")]
    if len(content) == 1:
        raise ValueError("No source content — attach a file and try again.")
    body = {
        "model": model,
        "max_tokens": DEFAULT_MAX_TOKENS,
        "system": [{
            "type": "text",
            "text": SYSTEM_PROMPT,
            "cache_control": {"type": "ephemeral"},
        }],
        "messages": [{"role": "user", "content": content}],
    }
    raw = _call_claude(api_key, body)
    _, module_json = _split_reply_and_json(raw)
    if not module_json:
        raise ValueError("Claude didn't return a JSON module block — try again.")
    return module_json


# ------------------------------------------------------------------
# HTTP + parsing helpers
# ------------------------------------------------------------------

def _call_claude(api_key, body):
    headers = {
        "x-api-key": api_key,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
    }
    try:
        r = requests.post(ANTHROPIC_URL, headers=headers, json=body, timeout=DEFAULT_TIMEOUT)
    except requests.RequestException as e:
        log.exception("Anthropic request failed")
        raise RuntimeError(f"Couldn't reach Claude: {e}")

    if r.status_code >= 300:
        log.error("Claude error %s: %s", r.status_code, r.text[:500])
        raise RuntimeError(_friendly_http_error(r))

    data = r.json()
    usage = data.get("usage") or {}
    log.info(
        "Claude chat_turn usage: input=%s output=%s cache_create=%s cache_read=%s",
        usage.get("input_tokens"),
        usage.get("output_tokens"),
        usage.get("cache_creation_input_tokens"),
        usage.get("cache_read_input_tokens"),
    )
    blocks = data.get("content") or []
    text = ""
    for b in blocks:
        if b.get("type") == "text":
            text += b.get("text", "")
    if not text.strip():
        stop_reason = data.get("stop_reason", "")
        raise RuntimeError(f"Claude returned an empty response (stop_reason={stop_reason or 'unknown'})")
    return text


def _friendly_http_error(resp):
    try:
        body = resp.json()
    except ValueError:
        body = {}
    err = (body.get("error") or {}) if isinstance(body, dict) else {}
    msg = err.get("message") or ""
    etype = err.get("type") or ""

    if resp.status_code == 429 or etype == "rate_limit_error":
        # Anthropic: retry-after is sometimes in headers, sometimes in message
        retry_after = resp.headers.get("retry-after") or ""
        if retry_after:
            return f"Claude rate limit hit — retry in ~{retry_after}s."
        return "Claude rate limit hit — wait a minute and try again."
    if resp.status_code in (401, 403):
        return "Claude auth failed — check ANTHROPIC_API_KEY"
    if resp.status_code == 400:
        return f"Claude rejected the request: {msg or 'bad input'}"
    if resp.status_code == 413:
        return "File too large for Claude to process in one request."
    if resp.status_code >= 500:
        return f"Claude is having a problem (HTTP {resp.status_code}). Try again in a moment."
    return f"Claude returned HTTP {resp.status_code}: {msg}".strip()


def _split_reply_and_json(raw):
    if not raw:
        return "", None
    m = _JSON_BLOCK_RE.search(raw)
    if not m:
        fence = _FENCE_RE.match(raw.strip())
        if fence:
            candidate = fence.group(1).strip()
            try:
                parsed = json.loads(candidate)
                return "", json.dumps(parsed, indent=2, ensure_ascii=False)
            except json.JSONDecodeError:
                pass
        return raw.strip(), None
    json_str = m.group(1).strip()
    reply = raw[:m.start()].rstrip()
    try:
        parsed = json.loads(json_str)
        pretty = json.dumps(parsed, indent=2, ensure_ascii=False)
        return reply, pretty
    except json.JSONDecodeError:
        return raw.strip(), None


def _trim(history, max_turns=MAX_HISTORY_TURNS):
    return history[-max_turns:] if len(history) > max_turns else history


def _first_file_turn_index(history):
    for i, turn in enumerate(history):
        if turn.get("role") == "user" and turn.get("file_ids"):
            return i
    return -1
