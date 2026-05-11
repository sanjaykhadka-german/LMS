import { requireAdmin } from "~/lib/auth/admin";
import { formatDateTime } from "~/lib/format/datetime";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { TimezoneForm } from "./TimezoneForm";

export const metadata = { title: "Workspace" };

function listTimezones(): string[] {
  type IntlWithZones = typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  const intlWithZones = Intl as IntlWithZones;
  if (typeof intlWithZones.supportedValuesOf === "function") {
    try {
      return intlWithZones.supportedValuesOf("timeZone");
    } catch {
      // fall through to fallback
    }
  }
  return [
    "Australia/Sydney",
    "Australia/Melbourne",
    "Australia/Brisbane",
    "Australia/Adelaide",
    "Australia/Perth",
    "Pacific/Auckland",
    "UTC",
  ];
}

export default async function WorkspaceSettingsPage() {
  const ctx = await requireAdmin();
  const zones = listTimezones();
  const previewNow = formatDateTime(new Date(), ctx.tenantTimezone);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Workspace</h1>
        <p className="text-sm text-[color:var(--muted-foreground)]">
          Settings that apply to everyone in this workspace.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Timezone</CardTitle>
          <CardDescription>
            Currently {ctx.tenantTimezone}. Right now it&apos;s {previewNow} here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TimezoneForm current={ctx.tenantTimezone} zones={zones} />
        </CardContent>
      </Card>
    </div>
  );
}
