import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isValidSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { TNG_PROSPECTING_SOURCES, Lead } from "@/lib/types";
import DashboardClient from "../dashboard-client";

/** Menu separado pra leads de prospecção ativa (outbound) via TNG Pesquisa
 * (aba Maps, importado via scripts/import_tng_leads.py), mais o importador
 * mais antigo (scripts/import_prospeccao_csv.py). Reaproveita o mesmo
 * Kanban/board de app/dashboard/page.tsx (DashboardClient), só que restrito a
 * `source in TNG_PROSPECTING_SOURCES` — tanto na carga inicial quanto no
 * polling (via `pollQuery`). Leads de Instagram ficam fora daqui: têm janela
 * própria (ver app/dashboard/prospeccao/instagram/page.tsx), com abordagem e
 * modelos de mensagem específicos pro Direct. */
export default async function ProspeccaoPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!isValidSessionToken(token)) {
    redirect("/login");
  }

  const supabase = createServiceClient();
  const { data } = await supabase
    .from("leads")
    .select("*")
    .is("merged_into_lead_id", null)
    .in("source", TNG_PROSPECTING_SOURCES)
    .order("created_at", { ascending: false });

  return (
    <DashboardClient
      initialLeads={(data as Lead[]) ?? []}
      title="Prospecção Ativa"
      pollQuery={`source=${TNG_PROSPECTING_SOURCES.join(",")}`}
      enableTngImport
    />
  );
}
