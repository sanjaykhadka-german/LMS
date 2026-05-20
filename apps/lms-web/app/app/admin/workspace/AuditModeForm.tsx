"use client";

import { useActionState } from "react";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import {
  updateWorkspaceAuditModeAction,
  type WorkspaceFormState,
} from "./actions";

const initial: WorkspaceFormState = { status: "idle" };

interface Props {
  current: boolean;
}

export function AuditModeForm({ current }: Props) {
  const [state, formAction, pending] = useActionState(
    updateWorkspaceAuditModeAction,
    initial,
  );

  return (
    <form
      action={formAction}
      className="space-y-4"
      key={state.status === "ok" ? state.message : "form"}
    >
      <div className="space-y-1.5">
        <Label
          htmlFor="auditMode"
          className="flex items-center gap-3 text-sm font-normal"
        >
          <input
            id="auditMode"
            name="auditMode"
            type="checkbox"
            defaultChecked={current}
            className="h-4 w-4 rounded border-[color:var(--border)]"
          />
          <span>Audit Mode is currently {current ? "ON" : "OFF"}</span>
        </Label>
        <p className="text-xs text-[color:var(--muted-foreground)]">
          When ON, admin and manager screens hide incomplete assignments,
          failed attempts, overdue work, expired certifications,
          unpublished modules, and inactive employees from compliance
          totals. Learner-facing pages are unaffected. Every flip is
          recorded in the audit log.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {state.status === "ok" && (
          <p className="text-xs text-emerald-600">{state.message}</p>
        )}
        {state.status === "error" && (
          <p className="text-xs text-[color:var(--destructive)]">{state.message}</p>
        )}
      </div>
    </form>
  );
}
