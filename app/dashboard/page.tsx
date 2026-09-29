import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isValidSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { ACTIVE_PROSPECTING_SOURCES, Lead } from "@/lib/types";
import DashboardClient from "./dashboard-client";

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!isValidSessionToken(token)) {
    redirect("/login");
  }

  // Leads de prospecção ativa (TNG Pesquisa etc.) têm menu próprio em
  // /dashboard/prospeccao — não aparecem aqui, pra manter este Kanban focado
  // em tráfego pago/Trello (ver app/dashboard/prospeccao/page.tsx). Cadastro
  // manual não nasce mais aqui (ver computedSource em app/api/leads/route.ts):
  // esta tela é exclusiva pra leads que chegam de fora (Meta Ads/Trello).
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("leads")
    .select("*")
    .is("merged_into_lead_id", null)
    .not("source", "in", `(${ACTIVE_PROSPECTING_SOURCES.join(",")})`)
    .order("created_at", { ascending: false });

  return (
    <DashboardClient
      initialLeads={(data as Lead[]) ?? []}
      pollQuery={`excludeSource=${ACTIVE_PROSPECTING_SOURCES.join(",")}`}
      // Permite mover um lead que chegou por engano (ou não faz mais sentido
      // aqui) pra Prospecção Ativa — ver enableSendToProspecting em
      // dashboard-client.tsx.
      enableSendToProspecting
    />
  );
}
