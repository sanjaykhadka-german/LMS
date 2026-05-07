"use client";

import Link from "next/link";
import { useFormStatus } from "react-dom";
import { Button } from "~/components/ui/button";
import {
  changeEmployeeRoleAction,
  resetEmployeePasswordAction,
  toggleEmployeeActiveAction,
} from "./actions";

interface Props {
  id: number;
  isActive: boolean;
  currentRole: string;
}

export function RowActions({ id, isActive, currentRole }: Props) {
  return (
    <div className="flex items-center justify-end gap-1">
      <Button asChild variant="outline" size="sm">
        <Link href={`/app/admin/employees/${id}/edit`}>Edit</Link>
      </Button>

      <form action={toggleEmployeeActiveAction}>
        <input type="hidden" name="id" value={id} />
        <SubmitButton label={isActive ? "Disable" : "Enable"} />
      </form>

      <RolePicker id={id} currentRole={currentRole} />

      <form
        action={resetEmployeePasswordAction}
        onSubmit={(e) => {
          if (!confirm("Reset password? A temporary password will be generated.")) {
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name="id" value={id} />
        <SubmitButton label="Reset PW" />
      </form>
    </div>
  );
}

function RolePicker({ id, currentRole }: { id: number; currentRole: string }) {
  return (
    <form action={changeEmployeeRoleAction} className="contents">
      <input type="hidden" name="id" value={id} />
      <select
        name="role"
        defaultValue={currentRole}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="h-8 rounded-md border border-[color:var(--input)] bg-transparent px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
        aria-label="Role"
      >
        <option value="employee">Employee</option>
        <option value="qaqc">QA/QC</option>
        <option value="admin">Admin</option>
      </select>
    </form>
  );
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      {pending ? "…" : label}
    </Button>
  );
}
