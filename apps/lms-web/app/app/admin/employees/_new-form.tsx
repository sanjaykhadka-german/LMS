"use client";

import { useActionState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { createEmployeeAction } from "./actions";
import type { FormState } from "../_components/NameCrudForm";

const initial: FormState = { status: "idle" };

interface Props {
  departments: Array<{ id: number; name: string }>;
  employers: Array<{ id: number; name: string }>;
  positions: Array<{ id: number; name: string }>;
}

export function NewEmployeeForm({ departments, employers, positions }: Props) {
  const [state, formAction, pending] = useActionState(createEmployeeAction, initial);

  const fieldError = (k: string) =>
    state.status === "error" ? state.fieldErrors?.[k]?.[0] : undefined;

  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="First name" name="first_name" required error={fieldError("firstName")} />
      <Field label="Last name" name="last_name" required error={fieldError("lastName")} />
      <Field label="Email" name="email" type="email" required error={fieldError("email")} />
      <Field label="Phone" name="phone" required error={fieldError("phone")} />
      <Selectish
        label="Department"
        name="department_id"
        required
        options={departments.map((d) => ({ value: String(d.id), label: d.name }))}
        error={fieldError("departmentId")}
      />
      <DatalistField
        label="Employer"
        name="employer_name"
        listId="employer-list"
        options={employers.map((e) => e.name)}
        required
        error={fieldError("employerName")}
      />
      <Field label="Job title" name="job_title" />
      <Selectish
        label="Position"
        name="position_id"
        options={[
          { value: "", label: "— None —" },
          ...positions.map((p) => ({ value: String(p.id), label: p.name })),
        ]}
        defaultValue=""
      />
      <Selectish
        label="Role"
        name="role"
        options={[
          { value: "employee", label: "Employee" },
          { value: "qaqc", label: "QA/QC" },
          { value: "admin", label: "Admin (owners only)" },
        ]}
        defaultValue="employee"
      />
      <Field label="Start date" name="start_date" type="date" />
      <Field label="Termination date" name="termination_date" type="date" />

      <div className="sm:col-span-2 lg:col-span-3 flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Add employee"}
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

function Field({
  label,
  name,
  type = "text",
  required,
  error,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  error?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>
        {label}
        {required && " *"}
      </Label>
      <Input id={name} name={name} type={type} required={required} aria-invalid={!!error} />
      {error && <p className="text-xs text-[color:var(--destructive)]">{error}</p>}
    </div>
  );
}

function Selectish({
  label,
  name,
  options,
  required,
  error,
  defaultValue,
}: {
  label: string;
  name: string;
  options: Array<{ value: string; label: string }>;
  required?: boolean;
  error?: string;
  defaultValue?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>
        {label}
        {required && " *"}
      </Label>
      <select
        id={name}
        name={name}
        defaultValue={defaultValue ?? ""}
        required={required}
        className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
        aria-invalid={!!error}
      >
        {required && !defaultValue && <option value="">— Select —</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-[color:var(--destructive)]">{error}</p>}
    </div>
  );
}

function DatalistField({
  label,
  name,
  listId,
  options,
  required,
  error,
}: {
  label: string;
  name: string;
  listId: string;
  options: string[];
  required?: boolean;
  error?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>
        {label}
        {required && " *"}
      </Label>
      <Input
        id={name}
        name={name}
        list={listId}
        required={required}
        aria-invalid={!!error}
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      <p className="text-xs text-[color:var(--muted-foreground)]">
        Type a new name to create one.
      </p>
      {error && <p className="text-xs text-[color:var(--destructive)]">{error}</p>}
    </div>
  );
}
