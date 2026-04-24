"""Provider dispatcher — picks Claude or Gemini based on config.

Resolution order:
1. AI_PROVIDER env var, if set to 'claude' or 'gemini'.
2. Otherwise: use Claude if CLAUDE_API_KEY is set, else Gemini if
   GEMINI_API_KEY is set.
3. If neither is set, raise on first use.
"""
from flask import current_app


def current_provider():
    override = (current_app.config.get("AI_PROVIDER") or "").strip().lower()
    if override in ("claude", "gemini"):
        return override
    if current_app.config.get("CLAUDE_API_KEY"):
        return "claude"
    if current_app.config.get("GEMINI_API_KEY"):
        return "gemini"
    raise RuntimeError(
        "No AI provider configured — set CLAUDE_API_KEY or GEMINI_API_KEY."
    )


def _backend():
    provider = current_provider()
    if provider == "claude":
        import claude_service as backend
    else:
        import gemini_service as backend
    return backend


def chat_turn(user_text, file_ids):
    return _backend().chat_turn(user_text, file_ids)


def generate_module_json(source_parts, module_id, sqf_clause):
    return _backend().generate_module_json(source_parts, module_id, sqf_clause)
