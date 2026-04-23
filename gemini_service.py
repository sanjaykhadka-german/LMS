import json
import logging
import os
import re

import requests
from flask import current_app

log = logging.getLogger(__name__)

GEMINI_URL_TEMPLATE = (
    "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
)
DEFAULT_MAX_TOKENS = 8192
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
    api_key = current_app.config.get("GEMINI_API_KEY", "")
    if not api_key:
        raise RuntimeError("Gemini API key not configured")

    model = current_app.config.get("GEMINI_MODEL", "gemini-2.5-flash")

    user_msg = (
        f"moduleId: {module_id or '(not supplied — infer or ask for it in the JSON)'}\n"
        f"sqfClause: {sqf_clause or '(not supplied — infer from the document)'}\n\n"
        "Source document:\n"
        f"{source_text}\n\n"
        "Return only the training module JSON — no prose, no code fences."
    )

    body = {
        "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": [{"role": "user", "parts": [{"text": user_msg}]}],
        "generationConfig": {
            "maxOutputTokens": DEFAULT_MAX_TOKENS,
            "temperature": 0.7,
            "responseMimeType": "application/json",
        },
    }

    url = GEMINI_URL_TEMPLATE.format(model=model)
    headers = {"content-type": "application/json", "x-goog-api-key": api_key}

    try:
        r = requests.post(url, headers=headers, json=body, timeout=DEFAULT_TIMEOUT)
    except requests.RequestException as e:
        log.exception("Gemini request failed")
        raise RuntimeError(f"Couldn't reach Gemini: {e}")

    if r.status_code >= 300:
        log.error("Gemini error %s: %s", r.status_code, r.text[:500])
        raise RuntimeError(f"Gemini returned HTTP {r.status_code}")

    data = r.json()
    usage = data.get("usageMetadata") or {}
    log.info(
        "Gemini generate_module_json usage: prompt=%s output=%s cached=%s",
        usage.get("promptTokenCount"),
        usage.get("candidatesTokenCount"),
        usage.get("cachedContentTokenCount"),
    )

    candidates = data.get("candidates") or []
    if not candidates:
        raise RuntimeError("Gemini returned no candidates — possibly blocked by safety filters")

    finish_reason = candidates[0].get("finishReason", "")
    parts = (candidates[0].get("content") or {}).get("parts") or []
    text = ""
    for p in parts:
        if isinstance(p, dict) and p.get("text"):
            text = p["text"]
            break
    if not text:
        raise RuntimeError(
            f"Gemini returned an empty response (finishReason={finish_reason or 'unknown'})"
        )

    cleaned = _strip_fence(text)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as e:
        log.error("Gemini returned invalid JSON: %s | payload=%s", e, cleaned[:500])
        raise ValueError("Gemini returned invalid JSON — try again or adjust the source document")

    return json.dumps(parsed, indent=2, ensure_ascii=False)
