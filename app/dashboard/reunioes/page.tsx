import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isValidSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { Lead } from "@/lib/types";
import { noteEhConfirmacao } from "@/lib/whatsapp-templates";
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

  const leads = (data as Lead[]) ?? [];

  /* Quem já foi lembrado da própria reunião.
   *
   * Medido nas 41 reuniões da base: entre as 22 que receberam confirmação,
   * 18% viraram no-show; entre as 19 que não receberam, 58%. A taxa geral da
   * casa é 45%. O que separa as duas metades não é a hora, nem o dia da
   * semana, nem a antecedência: é ter recebido ou não uma mensagem.
   *
   * O dado é derivado da timeline (`lead_events`) em vez de guardado numa
   * coluna nova de propósito: o envio já era gravado lá desde sempre, então
   * derivar responde também pelo passado, enquanto uma coluna nova começaria
   * vazia e diria "ninguém foi confirmado" mesmo depois de alguém ter sido.
   *
   * Uma consulta só, limitada aos leads que estão no quadro. */
  const confirmacoes: Record<string, string> = {};
  if (leads.length > 0) {
    const { data: notas } = await supabase
      .from("lead_events")
      .select("lead_id, message, created_at")
      .in(
        "lead_id",
        leads.map((l) => l.id)
      )
      .eq("type", "note")
      .order("created_at", { ascending: true });

    for (const n of notas ?? []) {
      if (!noteEhConfirmacao(n.message as string)) continue;
      /* Ordem crescente, então a última atribuição vence e sobra a
         confirmação mais recente, que é a que importa pra saber se a reunião
         ATUAL foi confirmada. */
      confirmacoes[n.lead_id as string] = n.created_at as string;
    }
  }

  return (
    <DashboardClient
      initialLeads={leads}
      title="Reuniões Marcadas"
      pollQuery="status=reuniao_marcada"
      groupByMeetingUrgency
      confirmacoes={confirmacoes}
    />
  );
}
