import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isValidSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { Lead } from "@/lib/types";
import DashboardClient from "../dashboard-client";

/** Janela dedicada pra leads finalizados (`status: "finalizado"`), juntando
 * todos os canais/sources num só lugar (tráfego pago, Trello, prospecção
 * ativa, Instagram, internacional) — mesmo critério de separação por
 * `status` (em vez de `source`) usado em app/dashboard/reunioes/page.tsx.
 * Um lead marcado como "finalizado" some de todas as colunas do Kanban
 * principal (ver BOARD_STATUS_ORDER em dashboard-client.tsx) e passa a viver
 * só aqui, ordenado do mais antigo pro mais novo (`groupByOldestFirst`), pra
 * priorizar quem está esfriando há mais tempo na fila de remarketing. O
 * composer de WhatsApp detecta `lead.status === "finalizado"` e troca pro
 * canal "remarketing" automaticamente (ver WhatsAppComposerModal.tsx), que
 * só existe nessa janela: 3 mensagens de reaquecimento de baixa pressão (ver
 * lib/whatsapp-templates.ts). */
export default async function RemarketingPage() {
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
    .eq("status", "finalizado")
    .order("created_at", { ascending: true });

  return (
    <DashboardClient
      initialLeads={(data as Lead[]) ?? []}
      title="Remarketing"
      pollQuery="status=finalizado"
      groupByOldestFirst
    />
  );
}
