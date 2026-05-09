import Link from "next/link";
import { Sparkles } from "lucide-react";
import { requireAdmin } from "~/lib/auth/admin";
import { getClaudeApiKey } from "~/lib/ai/claude";
import { getStudioSession } from "~/lib/ai/sessions";
import { StudioClient } from "./_studio-client";

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
  // Drop turns that have no text content (e.g. a user turn that was just an
  // attachment) since the file pills surface those separately.
  const initialMessages = session.history
    .map((turn) => {
      const text = turn.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      return { role: turn.role, text };
    })
    .filter((m) => m.text);

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
        initialModuleJson={session.currentModuleJson}
      />
    </div>
  );
}
