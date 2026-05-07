"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages, pending]);

  async function uploadFile(file: File) {
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    setPending(true);
    try {
      const res = await fetch("/api/admin/ai-studio/upload", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Upload failed");
        return;
      }
      setFiles((prev) => [...prev, data.file]);
    } finally {
      setPending(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function send() {
    const trimmed = text.trim();
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

  if (!hasProvider) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Configure your LLM provider</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            AI Studio is shipped without a default provider so it doesn’t cost
            anything until you opt in. Set <code>ANTHROPIC_API_KEY</code> on the{" "}
            <code>lms-web</code> service in Render and redeploy.
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
      {/* Left pane — chat */}
      <Card className="flex flex-col">
        <CardHeader className="flex-row items-center justify-between gap-2">
          <CardTitle className="text-lg">Chat</CardTitle>
          <Button variant="outline" size="sm" onClick={reset} disabled={pending}>
            Reset
          </Button>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-3">
          <div
            ref={logRef}
            className="flex-1 min-h-[260px] max-h-[420px] overflow-y-auto rounded-md border border-[color:var(--border)] bg-[color:var(--secondary)]/30 p-3 text-sm"
          >
            {messages.length === 0 && !pending && (
              <p className="text-[color:var(--muted-foreground)]">
                Drop a PDF, DOCX, or image (or just describe the topic), then
                ask Claude to draft a module.
              </p>
            )}
            {messages.map((m, i) => (
              <div key={i} className="mb-3 last:mb-0">
                <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted-foreground)]">
                  {m.role === "user" ? "You" : "Claude"}
                </div>
                <div className="whitespace-pre-wrap">{m.text}</div>
              </div>
            ))}
            {pending && (
              <div className="text-[color:var(--muted-foreground)]">…</div>
            )}
          </div>

          {files.length > 0 && (
            <ul className="text-xs text-[color:var(--muted-foreground)]">
              {files.map((f) => (
                <li key={f.id}>
                  {f.kind.toUpperCase()} · {f.name} ({prettyBytes(f.size)})
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-col gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
              }}
              placeholder="Ask Claude to draft 5 questions on knife safety from the SOP… (Ctrl+Enter to send)"
              className="min-h-[80px] rounded-md border border-[color:var(--input)] bg-transparent p-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
            />
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg,image/gif,image/webp"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadFile(f);
                }}
                className="text-xs"
              />
              <div className="flex-1" />
              <Button onClick={send} disabled={pending || !text.trim()}>
                Send
              </Button>
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-[color:var(--destructive)] bg-[color:var(--destructive)]/5 px-3 py-2 text-sm text-[color:var(--destructive)]">
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
              Once Claude returns a module JSON object, it will appear here for
              review. You can then import it as a new module or apply it to an
              existing one.
            </p>
          ) : (
            <>
              <ModulePreview json={moduleJson} />
              <div className="flex flex-wrap gap-2">
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

  const sections = Array.isArray(parsed.sections) ? parsed.sections : [];
  const quiz = (parsed.quiz ?? {}) as { questions?: unknown[] };
  const qCount = Array.isArray(quiz.questions) ? quiz.questions.length : 0;

  return (
    <div className="space-y-2 text-sm">
      <div className="font-semibold">{String(parsed.title ?? "Untitled")}</div>
      {typeof parsed.subtitle === "string" && parsed.subtitle.length > 0 && (
        <div className="text-[color:var(--muted-foreground)]">
          {parsed.subtitle}
        </div>
      )}
      <div className="flex flex-wrap gap-3 text-xs text-[color:var(--muted-foreground)]">
        <span>{sections.length} section{sections.length === 1 ? "" : "s"}</span>
        <span>{qCount} question{qCount === 1 ? "" : "s"}</span>
      </div>
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
