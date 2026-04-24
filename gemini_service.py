"""Gemini client for the AI module studio.

Two entry points:
- chat_turn(user_text, file_ids) — multi-turn chat, pulls history from flask.session.
- generate_module_json(source_parts, module_id, sqf_clause) — thin adapter used
  by the legacy one-shot route; does a single turn and returns just the JSON.
"""
import json
import logging
import os
import re

import requests
from flask import current_app, session

from file_extract import build_parts_for_file

log = logging.getLogger(__name__)

GEMINI_URL_TEMPLATE = (
    "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
)
DEFAULT_MAX_TOKENS = 8192
DEFAULT_TIMEOUT = 180
MAX_HISTORY_TURNS = 20

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
        + "Inputs can be any mix of the following — all of them are valid starting "
        + "points for a training module:\n"
        + "- **Documents**: NC reports, audit findings, SQF procedures, SOPs, corrective "
        + "action records, toolbox-talk notes.\n"
        + "- **Images**: photos of products (ham, salami, bratwurst, etc.), labels, "
        + "equipment, the production floor, non-conformance evidence.\n"
        + "- **Audio**: recorded toolbox talks, interview/debrief recordings, training "
        + "sessions.\n"
        + "- **Video**: floor walk-throughs, process recordings, product demonstrations.\n\n"
        + "## How to treat non-document inputs\n\n"
        + "**Do NOT refuse.** Never respond with 'I need a text document' or 'I can't "
        + "build a module from this image/audio/video.' You always can. Examples:\n"
        + "- Photo of ham on a butcher board → pick the most relevant German Butchery "
        + "angle (labelling, handling hygiene, storage temps, allergen control, "
        + "cross-contamination, slicing safety) and build the module. Briefly say which "
        + "angle you picked at the top of your reply.\n"
        + "- Photo of a label → labelling / traceability training.\n"
        + "- Photo of chiller or equipment → temperature control or equipment hygiene.\n"
        + "- Audio toolbox talk → build the module from what's discussed.\n"
        + "- Video floor walk → build the module from what's observed.\n\n"
        + "Only ask a clarifying question if the content is genuinely ambiguous AND you "
        + "can't reasonably pick one angle. When you do ask, ask exactly one short "
        + "question and still offer to proceed with a default choice if they don't "
        + "answer (e.g. 'Want this focused on labelling, storage, or allergens? I'll "
        + "default to labelling if you don't say.').\n\n"
        + "If the user provides additional text alongside the media ('this is for "
        + "new starters on the slicing line'), that steers the angle. Use it."
    )


SYSTEM_PROMPT = _load_system_prompt()


def _config():
    api_key = current_app.config.get("GEMINI_API_KEY", "")
    if not api_key:
        raise RuntimeError("Gemini API key not configured")
    model = current_app.config.get("GEMINI_MODEL", "gemini-2.5-flash")
    return api_key, model


def chat_turn(user_text, file_ids):
    """Run one chat turn. Updates session in place. Returns (reply_text, module_json_or_None)."""
    api_key, model = _config()

    studio = session.get("ai_studio") or {"history": [], "files": {}, "current_json": ""}
    files_map = studio.get("files") or {}

    # Build user parts: any attached files + the typed message
    user_parts = []
    for fid in file_ids or []:
        meta = files_map.get(fid)
        if not meta:
            continue
        user_parts.extend(build_parts_for_file(meta))
    if user_text:
        user_parts.append({"text": user_text})
    if not user_parts:
        raise ValueError("Type a message or attach a file.")

    # Reconstruct Gemini contents array from history, excluding stored file payloads
    # (too expensive to re-send). Instead, on the first turn that referenced a file,
    # we include it; later turns only include the text.
    contents = []
    for i, turn in enumerate(studio.get("history") or []):
        role = turn.get("role")
        parts = []
        # Only attach files on the first user turn that cited them, to save tokens —
        # Gemini carries context in the conversation history it receives.
        if role == "user":
            if turn.get("file_ids") and i == _first_file_turn_index(studio["history"]):
                for fid in turn["file_ids"]:
                    meta = files_map.get(fid)
                    if meta:
                        parts.extend(build_parts_for_file(meta))
            if turn.get("text"):
                parts.append({"text": turn["text"]})
        else:
            text = turn.get("text", "") or ""
            if turn.get("module_json"):
                text = text + "\n\n```json\n" + turn["module_json"] + "\n```"
            parts.append({"text": text})
        if parts:
            contents.append({"role": role, "parts": parts})

    contents.append({"role": "user", "parts": user_parts})

    body = {
        "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": contents,
        "generationConfig": {
            "maxOutputTokens": DEFAULT_MAX_TOKENS,
            "temperature": 0.7,
        },
    }

    reply_text_raw = _call_gemini(api_key, model, body)
    reply_text, module_json = _split_reply_and_json(reply_text_raw)

    # Persist the new turns to session
    history = studio.get("history") or []
    history.append({
        "role": "user",
        "text": user_text,
        "file_ids": list(file_ids or []),
    })
    history.append({
        "role": "model",
        "text": reply_text,
        "module_json": module_json,
    })
    studio["history"] = _trim(history)
    if module_json:
        studio["current_json"] = module_json
    session["ai_studio"] = studio
    session.modified = True

    return reply_text, module_json


def generate_module_json(source_parts, module_id, sqf_clause):
    """Legacy single-shot entry point used by /admin/modules/ai-generate.
    Does not touch session state — builds a fresh one-turn conversation."""
    api_key, model = _config()
    preamble = {
        "text": (
            f"moduleId: {module_id or '(not supplied — infer from the document)'}\n"
            f"sqfClause: {sqf_clause or '(not supplied — infer from the document)'}\n\n"
            "Build the training module now. Reply briefly, then include the full "
            "module JSON in a fenced ```json block."
        )
    }
    body = {
        "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": [{"role": "user", "parts": [preamble] + list(source_parts)}],
        "generationConfig": {
            "maxOutputTokens": DEFAULT_MAX_TOKENS,
            "temperature": 0.7,
        },
    }
    reply_raw = _call_gemini(api_key, model, body)
    _, module_json = _split_reply_and_json(reply_raw)
    if not module_json:
        raise ValueError("Gemini didn't return a JSON module block — try again or adjust the source.")
    return module_json


def _call_gemini(api_key, model, body):
    url = GEMINI_URL_TEMPLATE.format(model=model)
    headers = {"content-type": "application/json", "x-goog-api-key": api_key}
    try:
        r = requests.post(url, headers=headers, json=body, timeout=DEFAULT_TIMEOUT)
    except requests.RequestException as e:
        log.exception("Gemini request failed")
        raise RuntimeError(f"Couldn't reach Gemini: {e}")

    if r.status_code >= 300:
        log.error("Gemini error %s: %s", r.status_code, r.text[:500])
        raise RuntimeError(_friendly_http_error(r))

    data = r.json()
    usage = data.get("usageMetadata") or {}
    log.info(
        "Gemini chat_turn usage: prompt=%s output=%s cached=%s",
        usage.get("promptTokenCount"),
        usage.get("candidatesTokenCount"),
        usage.get("cachedContentTokenCount"),
    )
    candidates = data.get("candidates") or []
    if not candidates:
        raise RuntimeError("Gemini returned no candidates (safety filter?)")
    finish = candidates[0].get("finishReason", "")
    parts = (candidates[0].get("content") or {}).get("parts") or []
    text = ""
    for p in parts:
        if isinstance(p, dict) and p.get("text"):
            text += p["text"]
    if not text.strip():
        raise RuntimeError(f"Gemini returned empty text (finishReason={finish or 'unknown'})")
    return text


def _split_reply_and_json(raw):
    """Pull the trailing ```json block out of raw. Returns (reply_without_json, pretty_json_or_None).
    Gracefully handles: no block, block with surrounding whitespace, block that doesn't parse."""
    if not raw:
        return "", None
    m = _JSON_BLOCK_RE.search(raw)
    if not m:
        # Maybe the whole reply is a fenced block?
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
        # Leave the fence in so the user sees what went wrong
        return raw.strip(), None


def _friendly_http_error(resp):
    """Turn a Gemini error response into a message the user can act on."""
    try:
        body = resp.json()
    except ValueError:
        body = {}
    err = (body.get("error") or {}) if isinstance(body, dict) else {}
    msg = err.get("message") or ""

    if resp.status_code == 429:
        retry_delay = ""
        quota_metric = ""
        for d in err.get("details") or []:
            t = (d or {}).get("@type", "")
            if t.endswith("RetryInfo"):
                retry_delay = d.get("retryDelay", "") or ""
            elif t.endswith("QuotaFailure"):
                for v in d.get("violations") or []:
                    qid = (v.get("quotaId") or "").lower()
                    if "perminute" in qid:
                        quota_metric = "per-minute"
                    elif "perday" in qid or "daily" in qid:
                        quota_metric = "daily"
                    elif "token" in qid:
                        quota_metric = "token"
        parts = ["Gemini rate limit hit"]
        if quota_metric:
            parts.append(f"({quota_metric})")
        if retry_delay:
            parts.append(f"— retry in ~{retry_delay.rstrip('s')}s")
        else:
            parts.append("— wait a minute and try again")
        tail = " Free tier is 10 requests/min, 250/day."
        return " ".join(parts) + "." + tail

    if resp.status_code == 400:
        return f"Gemini rejected the request: {msg or 'bad input'}"
    if resp.status_code == 401 or resp.status_code == 403:
        return "Gemini auth failed — check GEMINI_API_KEY"
    if resp.status_code == 413:
        return "File too large for Gemini to process in one request."
    if resp.status_code >= 500:
        return f"Gemini is having a problem (HTTP {resp.status_code}). Try again in a moment."
    return f"Gemini returned HTTP {resp.status_code}: {msg}".strip()


def _trim(history, max_turns=MAX_HISTORY_TURNS):
    if len(history) <= max_turns:
        return history
    return history[-max_turns:]


def _first_file_turn_index(history):
    for i, turn in enumerate(history):
        if turn.get("role") == "user" and turn.get("file_ids"):
            return i
    return -1
