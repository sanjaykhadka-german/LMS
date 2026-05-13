"use client";

import { useActionState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  createShiftAction,
  updateShiftAction,
  type FormState,
} from "./actions";

const initial: FormState = { status: "idle" };

interface Props {
  mode: "create" | "edit";
  shiftId?: string;
  locations: Array<{ id: string; name: string }>;
  defaultValues?: {
    locationId: string;
    role: string;
    startsAt: string; // datetime-local format: YYYY-MM-DDTHH:mm
    endsAt: string;
    notes: string | null;
  };
}

export function ShiftForm({ mode, shiftId, locations, defaultValues }: Props) {
  const action =
    mode === "edit" && shiftId
      ? updateShiftAction.bind(null, shiftId)
      : createShiftAction;
  const [state, formAction, pending] = useActionState(action, initial);

  const submitLabel = mode === "edit" ? "Save changes" : "Create shift";
  const pendingLabel = mode === "edit" ? "Saving…" : "Creating…";

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor="locationId">Location</Label>
        <select
          id="locationId"
          name="locationId"
          defaultValue={defaultValues?.locationId ?? ""}
          required
          className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
        >
          <option value="" disabled>
            — Choose a location —
          </option>
          {locations.map((loc) => (
            <option key={loc.id} value={loc.id}>
              {loc.name}
            </option>
          ))}
        </select>
        {state.status === "error" && state.fieldErrors?.locationId && (
          <p className="text-xs text-[color:var(--destructive)]">
            {state.fieldErrors.locationId[0]}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="role">Role</Label>
        <Input
          id="role"
          name="role"
          defaultValue={defaultValues?.role ?? ""}
          placeholder="e.g. Butcher, Cashier, Cleaner"
          required
        />
        {state.status === "error" && state.fieldErrors?.role && (
          <p className="text-xs text-[color:var(--destructive)]">
            {state.fieldErrors.role[0]}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="startsAt">Starts</Label>
        <Input
          id="startsAt"
          name="startsAt"
          type="datetime-local"
          defaultValue={defaultValues?.startsAt ?? ""}
          required
        />
        {state.status === "error" && state.fieldErrors?.startsAt && (
          <p className="text-xs text-[color:var(--destructive)]">
            {state.fieldErrors.startsAt[0]}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="endsAt">Ends</Label>
        <Input
          id="endsAt"
          name="endsAt"
          type="datetime-local"
          defaultValue={defaultValues?.endsAt ?? ""}
          required
        />
        {state.status === "error" && state.fieldErrors?.endsAt && (
          <p className="text-xs text-[color:var(--destructive)]">
            {state.fieldErrors.endsAt[0]}
          </p>
        )}
      </div>

      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="notes">Notes (optional)</Label>
        <textarea
          id="notes"
          name="notes"
          defaultValue={defaultValues?.notes ?? ""}
          rows={3}
          placeholder="Anything the assigned employee should know"
          className="flex w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
        />
      </div>

      <div className="sm:col-span-2 flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? pendingLabel : submitLabel}
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
