import Link from "next/link";
import { Sparkles } from "lucide-react";
import { requireAdmin } from "~/lib/auth/admin";
import { getClaudeApiKey, splitReplyAndJson } from "~/lib/ai/claude";
import { getStudioSession } from "~/lib/ai/sessions";
import { StudioClient } from "./_studio-client";

interface RehydratedMessage {
  role: "user" | "assistant";
  text: string;
}

export const metadata = { title: "AI Studio" };

export default async function AiStudioPage({
  searchParams,
}: {
  searchParams: Promise<{ module_id?: string }>;
}) {
  const ctx = await requireAdmin();
  const sp = await searchParams;
  const hasProvider = Boolean(getClaudeApiKey());
  const moduleIdParam = sp.module_id ? parseInt(sp.module_id, 10) : NaN;
  const urlModuleId = Number.isFinite(moduleIdParam) ? moduleIdParam : null;

  // Rehydrate the persisted chat so navigating to Advanced edit / Preview /
  // Done and clicking "Back to AI Studio" returns the admin to the same
  // conversation. Server-side state lives in app.ai_studio_sessions keyed
  // by (userId, tenantId); empty when the user has never used AI Studio.
  const session = await getStudioSession(ctx.traceyUserId, ctx.traceyTenantId);

  // ChatTurn (server, multi-block) -> ChatMessage (client, plain text).
  // For assistant turns we run splitReplyAndJson so the chat shows just the
  // visible reply (no fenced JSON dump) and we can salvage the most recent
  // moduleJson into the right preview pane — even after import wiped
  // session.currentModuleJson. Mirrors what the message route does for live
  // turns; we just apply it to the persisted history at rehydration time.
  const initialMessages: RehydratedMessage[] = [];
  let salvagedModuleJson: string | null = null;
  for (const turn of session.history) {
    const text = turn.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    if (turn.role === "assistant") {
      const split = splitReplyAndJson(text);
      if (split.moduleJson) salvagedModuleJson = split.moduleJson;
      const visible =
        split.visibleReply.trim() ||
        "(Claude returned a module update — see the preview pane.)";
      initialMessages.push({ role: "assistant", text: visible });
    } else if (text) {
      initialMessages.push({ role: turn.role, text });
    }
  }

  const initialFiles = session.files.map((f) => ({
    id: f.id,
    kind: f.kind,
    name: f.name,
    size: f.size,
  }));

  return (
    <div className="space-y-6">
      <Link
        href="/app/admin/modules"
        className="text-sm text-[color:var(--muted-foreground)] underline"
      >
        ← Back to modules
      </Link>

      <div className="flex items-center gap-3">
        <Sparkles className="h-7 w-7 text-amber-500" aria-hidden />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">AI Studio</h1>
          <p className="text-sm text-[color:var(--muted-foreground)]">
            Upload an SOP / SQF document and have Claude draft a training module
            and quiz from it.
          </p>
        </div>
      </div>

      <StudioClient
        hasProvider={hasProvider}
        initialModuleId={urlModuleId ?? session.moduleId}
        initialMessages={initialMessages}
        initialFiles={initialFiles}
        initialModuleJson={session.currentModuleJson ?? salvagedModuleJson}
        initialDirtyJson={session.currentModuleJson != null}
      />
    </div>
  );
}
