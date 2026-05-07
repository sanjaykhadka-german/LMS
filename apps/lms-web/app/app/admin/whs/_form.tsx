import Link from "next/link";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";

interface WhsFormProps {
  action: (formData: FormData) => Promise<void>;
  record?: {
    id: number;
    kind: string;
    title: string;
    userId: number | null;
    issuedOn: string | null;
    expiresOn: string | null;
    notes: string | null;
    incidentDate: string | null;
    severity: string | null;
    reportedById: number | null;
  };
  staff: Array<{ id: number; name: string }>;
  errorBanner?: string;
}

export function WhsForm({ action, record, staff, errorBanner }: WhsFormProps) {
  const isEdit = Boolean(record);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{isEdit ? "Edit record" : "New record"}</CardTitle>
      </CardHeader>
      <CardContent>
        {errorBanner && (
          <div className="mb-4 rounded-md border border-[color:var(--destructive)] bg-[color:var(--destructive)]/5 px-4 py-2 text-sm text-[color:var(--destructive)]">
            {errorBanner}
          </div>
        )}
        <form action={action} className="grid gap-3 sm:grid-cols-2">
          {record && <input type="hidden" name="id" value={record.id} />}

          <div className="space-y-1">
            <Label htmlFor="kind">Kind *</Label>
            <select
              id="kind"
              name="kind"
              defaultValue={record?.kind ?? "high_risk_licence"}
              required
              className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm"
            >
              <option value="high_risk_licence">High-risk licence</option>
              <option value="fire_warden">Fire warden</option>
              <option value="first_aider">First aider</option>
              <option value="incident">Incident / near-miss</option>
            </select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              name="title"
              defaultValue={record?.title ?? ""}
              placeholder="e.g. LF licence — forklift"
              required
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="user_id">Person</Label>
            <select
              id="user_id"
              name="user_id"
              defaultValue={record?.userId ?? ""}
              className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm"
            >
              <option value="">— None —</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="issued_on">Issued on</Label>
            <Input
              id="issued_on"
              name="issued_on"
              type="date"
              defaultValue={record?.issuedOn ?? ""}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="expires_on">Expires on</Label>
            <Input
              id="expires_on"
              name="expires_on"
              type="date"
              defaultValue={record?.expiresOn ?? ""}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="incident_date">Incident date (incident only)</Label>
            <Input
              id="incident_date"
              name="incident_date"
              type="date"
              defaultValue={record?.incidentDate ?? ""}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="severity">Severity (incident only)</Label>
            <select
              id="severity"
              name="severity"
              defaultValue={record?.severity ?? ""}
              className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm"
            >
              <option value="">—</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="reported_by_id">Reported by (incident only)</Label>
            <select
              id="reported_by_id"
              name="reported_by_id"
              defaultValue={record?.reportedById ?? ""}
              className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm"
            >
              <option value="">—</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2 space-y-1">
            <Label htmlFor="notes">Notes</Label>
            <textarea
              id="notes"
              name="notes"
              defaultValue={record?.notes ?? ""}
              rows={3}
              className="w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 py-2 text-sm shadow-sm"
            />
          </div>

          <div className="sm:col-span-2 flex gap-2">
            <Button type="submit">{isEdit ? "Save" : "Create"}</Button>
            <Button asChild variant="outline">
              <Link href="/app/admin/whs">Cancel</Link>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
