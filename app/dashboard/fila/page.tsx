import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isValidSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { Lead } from "@/lib/types";
import { noteEhConfirmacao } from "@/lib/whatsapp-templates";
import FilaClient from "./fila-client";

/** A fila do dia: uma lista, em ordem, de quem falar agora — ver a
 * explicação do porquê em lib/fila-do-dia.ts.
 *
 * Esta página NÃO é mais um recorte do Kanban. As outras janelas do
 * dashboard respondem "como está o funil"; esta responde "por onde eu
 * começo", que é uma pergunta de uma resposta só e por isso é uma lista
 * numerada, não um quadro.
 *
 * A ordenação acontece no cliente (ver fila-client.tsx) de propósito: ela
 * depende de "hoje" e de "agora", e o relógio que vale é o de quem está
 * usando o CRM, não o do servidor da Vercel (que roda em UTC e viraria o dia
 * três horas antes aqui). Mesmo critério do resto do dashboard, que também
 * calcula a data local no navegador (ver todayISODate em dashboard-client.tsx). */

/** Status que podem entrar na fila por terem relógio: ou uma reunião
 * marcada, ou um `next_followup` agendado. Fora dessa lista sobra só o
 * estoque inbound em "novo_lead", buscado na segunda consulta. */
const STATUS_COM_RELOGIO = [
  "primeiro_contato",
  "segundo_contato",
  "terceiro_contato",
  "quarto_contato",
  "quinto_contato",
  "sexto_contato",
  "setimo_contato",
  "reuniao_marcada",
  "no_show",
  "diagnostico_enviado",
  "retornar_depois",
];

/** Sources inbound: o lead chegou pedindo contato. Precisa bater com
 * INBOUND_SOURCES em lib/fila-do-dia.ts. */
const INBOUND_SOURCES = ["trello", "meta_ads", "manual"];

export default async function FilaDoDiaPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!isValidSessionToken(token)) {
    redirect("/login");
  }

  const supabase = createServiceClient();

  /* Duas consultas em vez de "traga tudo e filtre depois": os 614 leads em
     "novo_lead" são quase todos prospecção fria (TNG, Instagram, EUA), que
     nunca entram na fila, e carregar a base inteira pra descartar 90% dela
     deixaria a página pesada sem motivo. */
  const [comRelogio, inbound] = await Promise.all([
    supabase
      .from("leads")
      .select("*")
      .is("merged_into_lead_id", null)
      .in("status", STATUS_COM_RELOGIO),
    supabase
      .from("leads")
      .select("*")
      .is("merged_into_lead_id", null)
      .eq("status", "novo_lead")
      .in("source", INBOUND_SOURCES)
      .not("phone", "is", null),
  ]);

  const leads = [
    ...((comRelogio.data as Lead[]) ?? []),
    ...((inbound.data as Lead[]) ?? []),
  ];

  /* Quem já recebeu a mensagem de confirmação da própria reunião — mesma
     derivação da janela de Reuniões (ver app/dashboard/reunioes/page.tsx):
     o envio fica gravado como `note` em lead_events com o nome do modelo,
     então derivar da timeline responde também pelo passado. Quem já foi
     confirmado sai da fila. */
  const confirmacoes: Record<string, string> = {};
  const idsComReuniao = leads
    .filter((l) => l.status === "reuniao_marcada")
    .map((l) => l.id);

  if (idsComReuniao.length > 0) {
    const { data: notas } = await supabase
      .from("lead_events")
      .select("lead_id, message, created_at")
      .in("lead_id", idsComReuniao)
      .eq("type", "note")
      .order("created_at", { ascending: true });

    for (const n of notas ?? []) {
      if (!noteEhConfirmacao(n.message as string)) continue;
      confirmacoes[n.lead_id as string] = n.created_at as string;
    }
  }

  return <FilaClient leads={leads} confirmacoes={confirmacoes} />;
}
