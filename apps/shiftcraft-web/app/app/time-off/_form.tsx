"use client";

import { useActionState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { submitTimeOffAction, type FormState } from "./actions";

const initial: FormState = { status: "idle" };

export function TimeOffForm() {
  const [state, formAction, pending] = useActionState(submitTimeOffAction, initial);

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor="startDate">Start date</Label>
        <Input id="startDate" name="startDate" type="date" required />
        {state.status === "error" && state.fieldErrors?.startDate && (
          <p className="text-xs text-[color:var(--destructive)]">
            {state.fieldErrors.startDate[0]}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="endDate">End date</Label>
        <Input id="endDate" name="endDate" type="date" required />
        {state.status === "error" && state.fieldErrors?.endDate && (
          <p className="text-xs text-[color:var(--destructive)]">
            {state.fieldErrors.endDate[0]}
          </p>
        )}
      </div>

      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="reason">Reason (optional)</Label>
        <textarea
          id="reason"
          name="reason"
          rows={3}
          placeholder="Annual leave, personal day, etc."
          className="flex w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
        />
      </div>

      <div className="sm:col-span-2 flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Submitting…" : "Submit request"}
        </Button>
        {state.status === "ok" && (
          <p className="text-xs text-emerald-600">{state.message}</p>
        )}
        {state.status === "error" && !state.fieldErrors && (
          <p className="text-xs text-[color:var(--destructive)]">{state.message}</p>
        )}
      </div>
    </form>
  );
}
