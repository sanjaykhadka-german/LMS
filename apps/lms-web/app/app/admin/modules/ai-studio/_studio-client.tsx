"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Paperclip } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";

interface FileMeta {
  id: string;
  kind: "pdf" | "docx" | "image";
  name: string;
  size: number;
}
interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

const ACCEPT =
  "application/pdf," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document," +
  "image/png,image/jpeg,image/gif,image/webp";

async function parseJsonResponse<T>(
  res: Response,
  fallbackMessage: string,
): Promise<T> {
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // Body wasn't JSON — error pages, plain-text 401s, etc.
    }
  }
  if (!res.ok) {
    const fromBody =
      parsed &&
      typeof parsed === "object" &&
      "error" in (parsed as Record<string, unknown>)
        ? String((parsed as { error: unknown }).error)
        : null;
    const fromText = text && !parsed ? text.slice(0, 200) : null;
    throw new Error(
      fromBody ?? fromText ?? `${fallbackMessage} (HTTP ${res.status})`,
    );
  }
  return parsed as T;
}

const RE_PROMPTS: Array<{ label: string; prompt: string }> = [
  {
    label: "Make it shorter",
    prompt:
      "Make this module shorter — keep the key takeaway and quiz, but trim each section's body to 1–2 punchy sentences.",
  },
  {
    label: "Make it longer",
    prompt:
      "Expand this module — add more concrete examples and context to each section, and add 2 more quiz questions.",
  },
];

export function StudioClient({
  hasProvider,
  initialModuleId,
}: {
  hasProvider: boolean;
  initialModuleId: number | null;
}) {
  const router = useRouter();
  const [files, setFiles] = useState<FileMeta[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [moduleJson, setModuleJson] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const dragCounter = useRef(0);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages, pending]);

  async function uploadFiles(fileList: FileList | File[]) {
    setError(null);
    const arr = Array.from(fileList).filter(Boolean);
    if (arr.length === 0) return;
    setPending(true);
    try {
      const results = await Promise.allSettled(
        arr.map(async (file) => {
          const fd = new FormData();
          fd.append("file", file);
          const res = await fetch("/api/admin/ai-studio/upload", {
            method: "POST",
            body: fd,
          });
          const data = await parseJsonResponse<{ file: FileMeta }>(
            res,
            `${file.name}: upload failed`,
          );
          return data.file;
        }),
      );
      const ok: FileMeta[] = [];
      const fails: string[] = [];
      for (const r of results) {
        if (r.status === "fulfilled") ok.push(r.value);
        else fails.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
      }
      if (ok.length > 0) setFiles((prev) => [...prev, ...ok]);
      if (fails.length > 0) setError(fails.join("\n"));
    } finally {
      setPending(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function removeFile(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }

  async function send(promptOverride?: string) {
    const trimmed = (promptOverride ?? text).trim();
    if (!trimmed || pending) return;
    setError(null);
    const fileIds = files.map((f) => f.id);
    setMessages((prev) => [...prev, { role: "user", text: trimmed }]);
    setText("");
    setPending(true);
    try {
      const res = await fetch("/api/admin/ai-studio/message", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: trimmed, fileIds }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Request failed");
        return;
      }
      setMessages((prev) => [...prev, { role: "assistant", text: data.reply }]);
      if (data.moduleJson) setModuleJson(data.moduleJson);
    } finally {
      setPending(false);
    }
  }

  async function reset() {
    if (!confirm("Clear the chat and uploaded files?")) return;
    setPending(true);
    try {
      await fetch("/api/admin/ai-studio/reset", { method: "POST" });
      setMessages([]);
      setFiles([]);
      setModuleJson(null);
      setError(null);
    } finally {
      setPending(false);
    }
  }

  async function importAsNew() {
    if (!moduleJson) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/ai-studio/import", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Import failed");
        return;
      }
      const newId = data.moduleIds?.[0];
      if (newId) router.push(`/app/admin/modules/${newId}`);
      else router.push("/app/admin/modules");
    } finally {
      setPending(false);
    }
  }

  async function applyToExisting() {
    if (!moduleJson || !initialModuleId) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/modules/${initialModuleId}/apply-ai-update`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Apply failed");
        return;
      }
      router.push(`/app/admin/modules/${initialModuleId}`);
    } finally {
      setPending(false);
    }
  }

  function usePrompt(p: string) {
    setText(p);
    textareaRef.current?.focus();
  }

  // Drag-and-drop handlers — track counter to debounce dragenter/leave.
  function onDragEnter(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current += 1;
    if (e.dataTransfer.types.includes("Files")) setDragActive(true);
  }
  function onDragLeave(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDragActive(false);
    }
  }
  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current = 0;
    setDragActive(false);
    if (e.dataTransfer.files.length > 0) {
      void uploadFiles(e.dataTransfer.files);
    }
  }

  if (!hasProvider) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Configure your LLM provider</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            AI Studio is shipped without a default provider so it doesn’t cost
            anything until you opt in. Set <code>ANTHROPIC_API_KEY</code> or{" "}
            <code>CLAUDE_API_KEY</code> on the <code>lms-web</code> service in
            Render and redeploy.
          </p>
          <p className="text-[color:var(--muted-foreground)]">
            Optional: <code>ANTHROPIC_MODEL</code> selects the Claude model
            (defaults to <code>claude-sonnet-4-6</code>; set to{" "}
            <code>claude-opus-4-7</code> for the most capable model).
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Left pane — chat (drag-drop target) */}
      <Card
        className={`flex flex-col transition-colors ${
          dragActive
            ? "border-amber-500 ring-2 ring-amber-500/30"
            : ""
        }`}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <CardHeader className="flex-row items-center justify-between gap-2">
          <CardTitle className="text-lg">Chat</CardTitle>
          <Button variant="outline" size="sm" onClick={reset} disabled={pending}>
            Reset
          </Button>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-3">
          <div
            ref={logRef}
            className="relative flex-1 min-h-[360px] max-h-[640px] overflow-y-auto rounded-md border border-[color:var(--border)] bg-[color:var(--secondary)]/30 p-4 text-sm"
          >
            {messages.length === 0 && !pending && !dragActive && (
              <p className="text-[color:var(--muted-foreground)]">
                Drop a PDF / DOCX / image (or several) onto this card, or use
                Choose files below — then describe the training topic and ask
                Claude to draft a module.
              </p>
            )}
            {messages.map((m, i) => (
              <div key={i} className="mb-4 last:mb-0">
                <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted-foreground)]">
                  {m.role === "user" ? "You" : "Claude"}
                </div>
                <div className="whitespace-pre-wrap leading-relaxed">{m.text}</div>
              </div>
            ))}
            {pending && (
              <div className="text-[color:var(--muted-foreground)]">
                Working…
              </div>
            )}
            {dragActive && (
              <div className="absolute inset-0 flex items-center justify-center rounded-md bg-amber-500/10 text-sm font-medium text-amber-700 dark:text-amber-300">
                Drop files to upload
              </div>
            )}
          </div>

          {files.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {files.map((f) => (
                <span
                  key={f.id}
                  className="inline-flex items-center gap-1 rounded-full border border-[color:var(--border)] bg-[color:var(--secondary)] px-2 py-1 text-xs"
                  title={`${f.kind.toUpperCase()} · ${prettyBytes(f.size)}`}
                >
                  <span className="font-medium">{f.kind.toUpperCase()}</span>
                  <span>{f.name}</span>
                  <button
                    type="button"
                    onClick={() => removeFile(f.id)}
                    className="ml-1 text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]"
                    aria-label={`Remove ${f.name}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
              }}
              placeholder="Ask Claude to draft 5 questions on knife safety from the SOP… (Ctrl+Enter to send)"
              className="min-h-[90px] rounded-md border border-[color:var(--input)] bg-transparent p-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
            />
            {moduleJson && (
              <div className="flex flex-wrap gap-2">
                {RE_PROMPTS.map((rp) => (
                  <Button
                    key={rp.label}
                    variant="outline"
                    size="sm"
                    onClick={() => usePrompt(rp.prompt)}
                    disabled={pending}
                  >
                    {rp.label}
                  </Button>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT}
                multiple
                onChange={(e) => {
                  const list = e.target.files;
                  if (list && list.length > 0) void uploadFiles(list);
                }}
                className="hidden"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={pending}
              >
                <Paperclip aria-hidden />
                Attach files
              </Button>
              <div className="flex-1" />
              <Button onClick={() => void send()} disabled={pending || !text.trim()}>
                Send
              </Button>
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-[color:var(--destructive)] bg-[color:var(--destructive)]/5 px-3 py-2 text-sm text-[color:var(--destructive)] whitespace-pre-wrap">
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Right pane — module preview */}
      <Card className="flex flex-col">
        <CardHeader>
          <CardTitle className="text-lg">Generated module</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-3">
          {!moduleJson ? (
            <p className="text-sm text-[color:var(--muted-foreground)]">
              Once Claude has a module ready, the title, sections, and quiz
              will appear here for review. You can then import it as a new
              module or apply it to an existing one.
            </p>
          ) : (
            <>
              <ModulePreview json={moduleJson} />
              <div className="flex flex-wrap gap-2 pt-2">
                <Button onClick={importAsNew} disabled={pending}>
                  Import as new module
                </Button>
                {initialModuleId && (
                  <Button
                    variant="outline"
                    onClick={applyToExisting}
                    disabled={pending}
                  >
                    Apply to module #{initialModuleId}
                  </Button>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface PreviewSection {
  heading: string;
  type: string;
  body: string;
  bullets: string[];
}

interface PreviewQuestion {
  question: string;
  type: string;
  options: string[];
  correctAnswer: number | boolean | undefined;
}

function ModulePreview({ json }: { json: string }) {
  let parsed: Record<string, unknown> | null = null;
  try {
    const obj = JSON.parse(json);
    parsed = Array.isArray(obj) ? obj[0] : obj;
  } catch {
    parsed = null;
  }

  if (!parsed) {
    return (
      <details>
        <summary className="cursor-pointer text-sm">
          Show raw output (could not parse)
        </summary>
        <pre className="mt-2 max-h-[280px] overflow-auto rounded-md border border-[color:var(--border)] bg-[color:var(--secondary)]/30 p-2 text-xs">
          {json}
        </pre>
      </details>
    );
  }

  const title = String(parsed.title ?? "Untitled");
  const subtitle = typeof parsed.subtitle === "string" ? parsed.subtitle : "";
  const summary = typeof parsed.summary === "string" ? parsed.summary : "";
  const keyTakeaway =
    typeof parsed.keyTakeaway === "string" ? parsed.keyTakeaway : "";
  const sections: PreviewSection[] = (Array.isArray(parsed.sections)
    ? parsed.sections
    : []
  )
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    .map((s) => ({
      heading: typeof s.heading === "string" ? s.heading : "Section",
      type: typeof s.type === "string" ? s.type : "section",
      body: typeof s.body === "string" ? s.body : "",
      bullets: Array.isArray(s.bullets) ? s.bullets.map(String) : [],
    }));
  const quiz = (parsed.quiz ?? {}) as { questions?: unknown[] };
  const questions: PreviewQuestion[] = (Array.isArray(quiz.questions)
    ? quiz.questions
    : []
  )
    .filter((q): q is Record<string, unknown> => !!q && typeof q === "object")
    .map((q) => ({
      question: typeof q.question === "string" ? q.question : "",
      type: typeof q.type === "string" ? q.type : "multiple_choice",
      options: Array.isArray(q.options) ? q.options.map(String) : [],
      correctAnswer:
        typeof q.correctAnswer === "number" || typeof q.correctAnswer === "boolean"
          ? q.correctAnswer
          : undefined,
    }));

  return (
    <div className="space-y-4 text-sm">
      <div>
        <h2 className="text-lg font-semibold leading-tight">{title}</h2>
        {subtitle && (
          <p className="text-[color:var(--muted-foreground)]">{subtitle}</p>
        )}
      </div>
      {summary && (
        <p className="leading-relaxed">{summary}</p>
      )}
      {keyTakeaway && (
        <div className="rounded-md border-l-4 border-amber-500 bg-amber-500/5 px-3 py-2">
          <div className="text-xs uppercase tracking-wide text-amber-700 dark:text-amber-300">
            Key takeaway
          </div>
          <div>{keyTakeaway}</div>
        </div>
      )}
      {sections.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted-foreground)]">
            Sections ({sections.length})
          </div>
          <ul className="space-y-2">
            {sections.map((s, i) => (
              <li
                key={i}
                className="rounded-md border border-[color:var(--border)] p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <strong>{s.heading}</strong>
                  <span className="text-xs text-[color:var(--muted-foreground)]">
                    {s.type}
                  </span>
                </div>
                {s.body && (
                  <p className="mt-1 text-[color:var(--muted-foreground)]">
                    {s.body.length > 240 ? s.body.slice(0, 240) + "…" : s.body}
                  </p>
                )}
                {s.bullets.length > 0 && (
                  <ul className="mt-1 list-disc pl-5 text-xs text-[color:var(--muted-foreground)]">
                    {s.bullets.slice(0, 4).map((b, j) => (
                      <li key={j}>{b}</li>
                    ))}
                    {s.bullets.length > 4 && (
                      <li>… {s.bullets.length - 4} more</li>
                    )}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {questions.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted-foreground)]">
            Quiz ({questions.length} question{questions.length === 1 ? "" : "s"})
          </div>
          <ol className="list-decimal space-y-2 pl-5">
            {questions.slice(0, 3).map((q, i) => (
              <li key={i}>
                <div>{q.question}</div>
                {q.options.length > 0 && (
                  <ul className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                    {q.options.map((o, j) => (
                      <li key={j}>
                        {j === q.correctAnswer ? "✓ " : "· "}
                        {o}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
            {questions.length > 3 && (
              <li className="text-xs text-[color:var(--muted-foreground)]">
                … {questions.length - 3} more
              </li>
            )}
          </ol>
        </div>
      )}
      <details>
        <summary className="cursor-pointer text-xs text-[color:var(--muted-foreground)]">
          Show raw JSON
        </summary>
        <pre className="mt-2 max-h-[280px] overflow-auto rounded-md border border-[color:var(--border)] bg-[color:var(--secondary)]/30 p-2 text-xs">
          {json}
        </pre>
      </details>
    </div>
  );
}

function prettyBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
