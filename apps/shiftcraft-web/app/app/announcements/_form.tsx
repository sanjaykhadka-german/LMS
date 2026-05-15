"use client";

import { useActionState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { createAnnouncementAction, type FormState } from "./actions";

const initial: FormState = { status: "idle" };

function fieldErr(state: FormState, k: string): string | null {
  if (state.status !== "error") return null;
  return state.fieldErrors?.[k]?.[0] ?? null;
}

export function AnnouncementForm() {
  const [state, formAction, pending] = useActionState(
    createAnnouncementAction,
    initial,
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          name="title"
          placeholder="e.g. Public holiday rosters"
          required
          aria-invalid={!!fieldErr(state, "title")}
        />
        {fieldErr(state, "title") && (
          <p className="text-xs text-[color:var(--destructive)]">
            {fieldErr(state, "title")}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="body">Message</Label>
        <textarea
          id="body"
          name="body"
          rows={5}
          required
          placeholder="What does the team need to know?"
          className="flex w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
        />
        {fieldErr(state, "body") && (
          <p className="text-xs text-[color:var(--destructive)]">
            {fieldErr(state, "body")}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex items-end gap-2">
          <input
            id="pinned"
            name="pinned"
            type="checkbox"
            defaultChecked
            className="h-4 w-4 rounded border-[color:var(--input)]"
          />
          <Label htmlFor="pinned" className="text-sm font-normal">
            Pin to dashboard (recommended)
          </Label>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="expiresAt">Expires (optional)</Label>
          <Input
            id="expiresAt"
            name="expiresAt"
            type="datetime-local"
            aria-invalid={!!fieldErr(state, "expiresAt")}
          />
        </div>
        <div className="sm:col-span-2 rounded-md border border-border bg-muted/30 p-3">
          <div className="flex items-start gap-2">
            <input
              id="notifyByEmail"
              name="notifyByEmail"
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-[color:var(--input)]"
            />
            <div className="space-y-0.5">
              <Label
                htmlFor="notifyByEmail"
                className="text-sm font-medium"
              >
                Also send by email to every team member
              </Label>
              <p className="text-xs text-muted-foreground">
                Use sparingly — sends one email per member to the address
                they signed up with. The author isn't emailed back.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Posting…" : "Post announcement"}
        </Button>
        {state.status === "error" && !state.fieldErrors && (
          <p className="text-xs text-[color:var(--destructive)]">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
