"use client";

import { useActionState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  createLocationAction,
  updateLocationAction,
  type FormState,
} from "./actions";

const initial: FormState = { status: "idle" };

const COMMON_TIMEZONES = [
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Brisbane",
  "Australia/Adelaide",
  "Australia/Perth",
  "Australia/Hobart",
  "Australia/Darwin",
  "Pacific/Auckland",
  "UTC",
];

interface Props {
  mode: "create" | "edit";
  locationId?: string;
  defaultValues?: {
    name: string;
    timezone: string;
    address: string | null;
    color: string | null;
  };
}

export function LocationForm({ mode, locationId, defaultValues }: Props) {
  const action =
    mode === "edit" && locationId
      ? updateLocationAction.bind(null, locationId)
      : createLocationAction;
  const [state, formAction, pending] = useActionState(action, initial);

  const submitLabel = mode === "edit" ? "Save changes" : "Add location";
  const pendingLabel = mode === "edit" ? "Saving…" : "Adding…";

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          name="name"
          defaultValue={defaultValues?.name ?? ""}
          placeholder="e.g. Brunswick Store"
          required
          aria-invalid={state.status === "error" && !!state.fieldErrors?.name}
        />
        {state.status === "error" && state.fieldErrors?.name && (
          <p className="text-xs text-[color:var(--destructive)]">
            {state.fieldErrors.name[0]}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="timezone">Timezone</Label>
        <select
          id="timezone"
          name="timezone"
          defaultValue={defaultValues?.timezone ?? "Australia/Sydney"}
          required
          className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
        >
          {COMMON_TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
        {state.status === "error" && state.fieldErrors?.timezone && (
          <p className="text-xs text-[color:var(--destructive)]">
            {state.fieldErrors.timezone[0]}
          </p>
        )}
      </div>

      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="address">Address (optional)</Label>
        <Input
          id="address"
          name="address"
          defaultValue={defaultValues?.address ?? ""}
          placeholder="123 Lygon St, Brunswick VIC 3056"
        />
        {state.status === "error" && state.fieldErrors?.address && (
          <p className="text-xs text-[color:var(--destructive)]">
            {state.fieldErrors.address[0]}
          </p>
        )}
      </div>

      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="color">Accent colour (optional)</Label>
        <div className="flex items-center gap-2">
          <input
            id="color"
            name="color"
            type="color"
            defaultValue={defaultValues?.color ?? "#7c1f1f"}
            className="h-9 w-12 cursor-pointer rounded-md border border-[color:var(--input)] bg-transparent p-1"
          />
          <span className="text-xs text-muted-foreground">
            Used to colour-code this location on the schedule and dashboard.
          </span>
        </div>
        {state.status === "error" && state.fieldErrors?.color && (
          <p className="text-xs text-[color:var(--destructive)]">
            {state.fieldErrors.color[0]}
          </p>
        )}
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
