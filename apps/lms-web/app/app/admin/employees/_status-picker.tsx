"use client";

import type { EmployeeStatus } from "~/lib/lms/employee-status";
import { setEmployeeStatusAction } from "./actions";

interface Props {
  id: number;
  status: EmployeeStatus;
  terminationDate: string | null;
}

const STATUS_LABEL: Record<EmployeeStatus, string> = {
  active: "Active",
  disabled: "Disabled",
  terminated: "Terminated",
};

// Tailwind utility classes per state — applied to the select so the row
// gets a colour hint without needing a separate badge.
const STATUS_CLASS: Record<EmployeeStatus, string> = {
  active:
    "border-emerald-600 bg-emerald-100 text-emerald-900 dark:border-emerald-500/60 dark:bg-emerald-900/40 dark:text-emerald-100",
  disabled:
    "border-amber-600 bg-amber-100 text-amber-900 dark:border-amber-500/60 dark:bg-amber-900/40 dark:text-amber-100",
  terminated:
    "border-[color:var(--border)] bg-[color:var(--muted)] text-[color:var(--foreground)]",
};

export function StatusPicker({ id, status, terminationDate }: Props) {
  return (
    <div className="flex flex-col gap-0.5">
      <form action={setEmployeeStatusAction} className="contents">
        <input type="hidden" name="id" value={id} />
        <select
          name="status"
          defaultValue={status}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          aria-label="Employee status"
          className={`h-8 rounded-md border px-2 text-xs font-medium shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)] ${STATUS_CLASS[status]}`}
        >
          <option value="active">{STATUS_LABEL.active}</option>
          <option value="disabled">{STATUS_LABEL.disabled}</option>
          <option value="terminated">{STATUS_LABEL.terminated}</option>
        </select>
      </form>
      {status === "terminated" && terminationDate && (
        <span className="text-[10px] text-[color:var(--muted-foreground)]">
          since {terminationDate}
        </span>
      )}
    </div>
  );
}
