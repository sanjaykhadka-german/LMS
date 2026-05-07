import Link from "next/link";
import { Sparkles } from "lucide-react";
import { requireAdmin } from "~/lib/auth/admin";
import { getClaudeApiKey } from "~/lib/ai/claude";
import { StudioClient } from "./_studio-client";

export const metadata = { title: "AI Studio" };

export default async function AiStudioPage({
  searchParams,
}: {
  searchParams: Promise<{ module_id?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const hasProvider = Boolean(getClaudeApiKey());
  const moduleIdParam = sp.module_id ? parseInt(sp.module_id, 10) : NaN;
  const initialModuleId = Number.isFinite(moduleIdParam) ? moduleIdParam : null;

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

      <StudioClient hasProvider={hasProvider} initialModuleId={initialModuleId} />
    </div>
  );
}
