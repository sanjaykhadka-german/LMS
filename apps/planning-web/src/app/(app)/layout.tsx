import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant";
import Sidebar from "@/components/sidebar";
import OfflineBanner from "@/components/offline-banner";
import { SyncProvider } from "@/lib/offline/sync-context";
import { I18nProvider } from "@/lib/i18n";
import { loadMessages } from "@/lib/i18n-server";
import type { UserRole } from "@/lib/types";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const [{ data: profile }, tenant] = await Promise.all([
    supabase.from("profiles").select("role, full_name, tenant_id").eq("id", user.id).single(),
    getTenant(),
  ]);

  // Fetch language separately — column may not exist yet if migration 002 hasn't run
  let userLanguage = "en";
  try {
    const { data: langRow } = await supabase
      .from("profiles")
      .select("language")
      .eq("id", user.id)
      .single();
    if (langRow?.language) userLanguage = langRow.language;
  } catch {
    // language column doesn't exist yet — stay on English
  }

  // Fetch active departments for sidebar
  const { data: departments } = await supabase
    .from("departments")
    .select("id, name, code, sort_order")
    .eq("tenant_id", profile?.tenant_id ?? "")
    .eq("is_active", true)
    .order("sort_order")
    .order("name");

  const { locale, messages } = await loadMessages(userLanguage);

  return (
    <SyncProvider>
      <I18nProvider locale={locale} messages={messages}>
        <OfflineBanner />
        <div style={{ display: "flex" }}>
          <Sidebar
            userEmail={user.email ?? ""}
            userRole={(profile?.role ?? "viewer") as UserRole}
            tenantName={tenant?.name ?? "Tracey"}
            departments={departments ?? []}
          />
          <main className="main-content" style={{ flex: 1, padding: "2rem" }}>
            {children}
          </main>
        </div>
      </I18nProvider>
    </SyncProvider>
  );
}
