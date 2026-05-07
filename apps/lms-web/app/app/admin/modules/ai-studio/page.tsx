import Link from "next/link";
import { Sparkles } from "lucide-react";
import { requireAdmin } from "~/lib/auth/admin";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Button } from "~/components/ui/button";

export const metadata = { title: "AI Studio" };

export default async function AiStudioPage() {
  await requireAdmin();
  const provider = process.env.OPENAI_API_KEY
    ? "openai"
    : process.env.ANTHROPIC_API_KEY
    ? "anthropic"
    : null;

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
            Upload an SOP / SQF document and have an LLM draft a quiz from it.
          </p>
        </div>
      </div>

      {provider === null ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Configure your LLM provider</CardTitle>
            <CardDescription>
              AI Studio is shipped without a default provider so it doesn’t cost
              anything until you opt in. Pick one and set the API key on the{" "}
              <code>lms-web</code> service in Render:
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--secondary)] p-3 font-mono text-xs">
              {/* OpenAI */}
              OPENAI_API_KEY=sk-…
              <br />
              {/* or */}
              ANTHROPIC_API_KEY=sk-ant-…
            </div>
            <p>
              After redeploy, AI Studio will switch to live mode. Until then,
              the chat UI below is read-only.
            </p>
            <div className="flex gap-2">
              <Button asChild variant="outline">
                <Link href="https://platform.openai.com/" target="_blank" rel="noreferrer">
                  Get an OpenAI key
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="https://console.anthropic.com/" target="_blank" rel="noreferrer">
                  Get an Anthropic key
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Live ({provider})</CardTitle>
            <CardDescription>
              The actual chat + quiz-generation UI ports in a follow-up slice.
              For now, your provider key is recognised and the UI will go live
              when that work lands.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* Static UI mockup so admins know what's coming. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Preview (UI mockup)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 opacity-60 pointer-events-none">
          <div className="rounded-md border border-dashed border-[color:var(--border)] p-4 text-sm">
            <p>Drop a PDF / DOCX here to extract source content…</p>
          </div>
          <div className="rounded-md border border-[color:var(--border)] p-4 text-sm">
            <strong>You:</strong> Generate 5 multiple-choice questions on knife
            safety from the uploaded SOP.
            <br />
            <strong>AI:</strong> <em>(coming soon)</em>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
