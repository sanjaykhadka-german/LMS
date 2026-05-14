"use client";

import { useActionState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { createEmployeeAction, type FormState } from "./actions";

const initial: FormState = { status: "idle" };

const EMPLOYMENT_TYPES: Array<{ value: string; label: string; hint: string }> = [
  {
    value: "permanent",
    label: "Permanent",
    hint: "Ongoing employee. Will trigger a training suggestion if email is set.",
  },
  {
    value: "casual",
    label: "Casual",
    hint: "Variable hours. Will trigger a training suggestion if email is set.",
  },
  {
    value: "labour_hire",
    label: "Labour hire",
    hint: "Roster-only. No LMS suggestion — not added to training cohort.",
  },
];

const WEEKDAYS: Array<{ key: string; label: string }> = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
];

function fieldError(state: FormState, key: string): string | null {
  if (state.status !== "error") return null;
  const errs = state.fieldErrors?.[key];
  return errs && errs.length > 0 ? (errs[0] ?? null) : null;
}

export function EmployeeForm() {
  const [state, formAction, pending] = useActionState(
    createEmployeeAction,
    initial,
  );

  return (
    <form action={formAction} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="fullName">Full name</Label>
          <Input
            id="fullName"
            name="fullName"
            placeholder="e.g. Jane Doe"
            required
            aria-invalid={!!fieldError(state, "fullName")}
          />
          {fieldError(state, "fullName") && (
            <p className="text-xs text-[color:var(--destructive)]">
              {fieldError(state, "fullName")}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">Email (optional)</Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="jane@example.com"
            aria-invalid={!!fieldError(state, "email")}
          />
          {fieldError(state, "email") ? (
            <p className="text-xs text-[color:var(--destructive)]">
              {fieldError(state, "email")}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Required for learner suggestion. Leave blank for labour-hire.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="mobile">Mobile</Label>
          <Input
            id="mobile"
            name="mobile"
            placeholder="0400 000 000"
            aria-invalid={!!fieldError(state, "mobile")}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="department">Department</Label>
          <Input
            id="department"
            name="department"
            placeholder="e.g. Butchery"
            aria-invalid={!!fieldError(state, "department")}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="employmentType">Employment type</Label>
          <select
            id="employmentType"
            name="employmentType"
            defaultValue="permanent"
            required
            className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
          >
            {EMPLOYMENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          {fieldError(state, "employmentType") && (
            <p className="text-xs text-[color:var(--destructive)]">
              {fieldError(state, "employmentType")}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Weekly availability (optional)</Label>
        <p className="text-xs text-muted-foreground">
          Free text per day, e.g. "9-5" or "evenings only". Leave blank for
          unspecified.
        </p>
        <div className="grid gap-2 sm:grid-cols-7">
          {WEEKDAYS.map((d) => (
            <div key={d.key} className="space-y-1">
              <Label
                htmlFor={`availability_${d.key}`}
                className="text-xs text-muted-foreground"
              >
                {d.label}
              </Label>
              <Input
                id={`availability_${d.key}`}
                name={`availability_${d.key}`}
                placeholder="—"
                className="h-8 text-xs"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="notes">Notes (optional)</Label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          className="flex w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
          placeholder="Anything the rostering team should know."
        />
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add employee"}
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
