import "server-only";
import path from "node:path";
import { promises as fs } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

// Default to Sonnet 4.6 to preserve parity with the Flask implementation
// (claude_service.py used claude-sonnet-4-6) and keep cost predictable. The
// `ANTHROPIC_MODEL` env var can override — set it to `claude-opus-4-7` for the
// most capable model, or any other supported ID.
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";

let _client: Anthropic | null = null;
export function anthropic(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  _client = new Anthropic({ apiKey });
  return _client;
}

export function aiStudioModel(): string {
  return MODEL;
}

let _systemPromptCache: string | null = null;

// Loads the qa-quiz-creator skill from the repo root. Mirrors what
// claude_service.py reads via _load_system_prompt(). Cached at process scope —
// the prompt only changes on deploy.
export async function loadSystemPrompt(): Promise<string> {
  if (_systemPromptCache) return _systemPromptCache;

  const root = process.cwd();
  // Locally and on Render the cwd is the lms-web app root. Resolve relative.
  const skillRoot = path.resolve(root, "..", "..", "skills", "qa-quiz-creator");
  const [skillMd, schemaMd] = await Promise.all([
    fs.readFile(path.join(skillRoot, "SKILL.md"), "utf8"),
    fs.readFile(path.join(skillRoot, "references", "module-schema.md"), "utf8"),
  ]);

  _systemPromptCache = `${skillMd}\n\n---\n\n${schemaMd}`;
  return _systemPromptCache;
}

// Parse out a leading or fenced module-JSON block from Claude's reply.
// Flask's apply path expects the model to emit a complete module JSON object
// when it has anything substantive to apply; we surface that to the UI so the
// preview pane updates and the "Import / Apply" buttons activate.
const FENCED_JSON_RE = /```(?:json)?\s*([\s\S]*?)\s*```/gm;

export function extractModuleJson(reply: string): string | null {
  // Try fenced blocks first.
  let lastValid: string | null = null;
  for (const match of reply.matchAll(FENCED_JSON_RE)) {
    const candidate = match[1]?.trim();
    if (!candidate) continue;
    if (looksLikeModuleObject(candidate)) lastValid = candidate;
  }
  if (lastValid) return lastValid;

  // Fall back to detecting a top-level JSON object.
  const start = reply.indexOf("{");
  if (start === -1) return null;
  const candidate = reply.slice(start);
  // Walk braces to find the matching close; cheap and good enough.
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < candidate.length; i++) {
    const ch = candidate[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const candidateJson = candidate.slice(0, i + 1);
        if (looksLikeModuleObject(candidateJson)) return candidateJson;
        return null;
      }
    }
  }
  return null;
}

function looksLikeModuleObject(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return false;
    // Module shape per skills/qa-quiz-creator/references/module-schema.md.
    return (
      typeof (parsed as { title?: unknown }).title === "string" &&
      Array.isArray((parsed as { sections?: unknown }).sections) ||
      Array.isArray((parsed as { content_items?: unknown }).content_items)
    );
  } catch {
    return false;
  }
}

export type ChatTurn = {
  role: "user" | "assistant";
  content: Anthropic.ContentBlockParam[];
};

export interface SendMessageInput {
  history: ChatTurn[];
  // Files to attach to the next user turn (PDF base64, image base64, DOCX text).
  attachments: Anthropic.ContentBlockParam[];
  text: string;
}

export interface SendMessageResult {
  reply: string;
  moduleJson: string | null;
  // Updated history including this turn's user + assistant entries.
  nextHistory: ChatTurn[];
}

export async function sendMessage(opts: SendMessageInput): Promise<SendMessageResult> {
  const system = await loadSystemPrompt();
  const userTurn: ChatTurn = {
    role: "user",
    content: [
      ...opts.attachments,
      { type: "text", text: opts.text },
    ],
  };
  const messages: ChatTurn[] = [...opts.history, userTurn];

  const response = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 16000,
    // Prompt caching: the system prompt is large (~8KB) and stable across
    // turns, so cache it. cache_read_input_tokens drops cost ~10x on
    // subsequent turns within the 5-minute TTL.
    system: [
      {
        type: "text",
        text: system,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages,
  });

  // Reduce content blocks to plain text for chat display + JSON extraction.
  let reply = "";
  for (const block of response.content) {
    if (block.type === "text") reply += block.text;
  }
  const moduleJson = extractModuleJson(reply);

  const assistantTurn: ChatTurn = {
    role: "assistant",
    content: response.content as Anthropic.ContentBlockParam[],
  };

  return {
    reply,
    moduleJson,
    nextHistory: [...messages, assistantTurn],
  };
}
