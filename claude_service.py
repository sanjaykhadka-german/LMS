import json
import logging
import os
import re

import requests
from flask import current_app

log = logging.getLogger(__name__)

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"
DEFAULT_MAX_TOKENS = 8000
DEFAULT_TIMEOUT = 120

_SKILL_DIR = os.path.join(os.path.dirname(__file__), "skills", "qa-quiz-creator")
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
        + "When invoked, produce ONLY the training module JSON object. "
        + "No prose before or after. No code fences. "
        + "The importing system ignores unknown top-level fields but honours "
        + "moduleId, slug, title, subtitle, summary, keyTakeaway, sections[], "
        + "and quiz.questions[]."
    )


SYSTEM_PROMPT = _load_system_prompt()


def _strip_fence(text):
    m = _FENCE_RE.match(text.strip())
    if m:
        return m.group(1).strip()
    return text.strip()


def generate_module_json(source_text, module_id, sqf_clause):
    api_key = current_app.config.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise RuntimeError("Claude API key not configured")

    model = current_app.config.get("CLAUDE_MODEL", "claude-sonnet-4-6")

    user_msg = (
        f"moduleId: {module_id or '(not supplied — infer or ask for it in the JSON)'}\n"
        f"sqfClause: {sqf_clause or '(not supplied — infer from the document)'}\n\n"
        "Source document:\n"
        f"{source_text}\n\n"
        "Return only the training module JSON — no prose, no code fences."
    )

    body = {
        "model": model,
        "max_tokens": DEFAULT_MAX_TOKENS,
        "system": [
            {
                "type": "text",
                "text": SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        "messages": [{"role": "user", "content": user_msg}],
    }

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
        log.error("Anthropic error %s: %s", r.status_code, r.text[:500])
        raise RuntimeError(f"Claude returned HTTP {r.status_code}")

    data = r.json()
    usage = data.get("usage") or {}
    log.info(
        "Claude generate_module_json usage: input=%s output=%s cache_create=%s cache_read=%s",
        usage.get("input_tokens"),
        usage.get("output_tokens"),
        usage.get("cache_creation_input_tokens"),
        usage.get("cache_read_input_tokens"),
    )

    blocks = data.get("content") or []
    text = ""
    for b in blocks:
        if b.get("type") == "text":
            text = b.get("text", "")
            break
    if not text:
        raise RuntimeError("Claude returned an empty response")

    cleaned = _strip_fence(text)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as e:
        log.error("Claude returned invalid JSON: %s | payload=%s", e, cleaned[:500])
        raise ValueError("Claude returned invalid JSON — try again or adjust the source document")

    return json.dumps(parsed, indent=2, ensure_ascii=False)
