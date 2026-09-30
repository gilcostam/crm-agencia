import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isValidSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { Lead } from "@/lib/types";
import DashboardClient from "../dashboard-client";

/** Janela dedicada pra leads com reunião marcada (`status: "reuniao_marcada"`),
 * juntando todos os canais/sources num só lugar (tráfego pago, Trello,
 * prospecção ativa, Instagram, internacional) — diferente das outras janelas
 * do dashboard, que separam por `source`, esta separa por `status`, porque o
 * que importa aqui não é de onde o lead veio, e sim não deixá-lo esfriar
 * entre marcar a reunião e o dia combinado (e evitar o No Show). Reaproveita
 * o mesmo Kanban/board (DashboardClient), mas com `groupByMeetingUrgency`
 * pra agrupar os cards por proximidade da reunião (ver meetingUrgency em
 * lib/types.ts) em vez de por status — todos os leads aqui já compartilham o
 * mesmo status, então colunas por status não fariam sentido. */
export default async function ReunioesMarcadasPage() {
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
    .eq("status", "reuniao_marcada")
    .order("meeting_datetime", { ascending: true });

  return (
    <DashboardClient
      initialLeads={(data as Lead[]) ?? []}
      title="Reuniões Marcadas"
      pollQuery="status=reuniao_marcada"
      groupByMeetingUrgency
    />
  );
}
