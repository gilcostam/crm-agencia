import { NextRequest, NextResponse } from "next/server";
import { hasValidSession } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import {
  LeadStatus,
  REMARKETING_STAGE_LABELS,
  REMARKETING_STAGE_ORDER,
  RemarketingStage,
  STATUS_LABELS,
  STATUS_ORDER,
} from "@/lib/types";
import { syncLeadStatusToTrello } from "@/lib/trello";
import { NOTA_MENSAGEM_PREPARADA } from "@/lib/whatsapp-templates";
import {
  buildStatusChangeUpdate,
  FOLLOWUP_INTERVAL_HOURS,
  LOSS_STATUSES,
  nuncaFoiContatado,
} from "@/lib/lead-status";

/** Únicos valores de `source` que este PATCH aceita receber — hoje só o
 * botão "Enviar para Prospecção Ativa" da tela de Leads (ver
 * app/dashboard/dashboard-client.tsx), que move um lead de tráfego
 * pago/Trello para o funil de prospecção ativa. Uma whitelist, não um
 * passthrough livre de `source`, pelo mesmo motivo do POST em
 * app/api/leads/route.ts: nenhum outro caminho pode forjar um `source`
 * arbitrário por aqui (ex.: "meta_ads", que dispara boas-vindas automática). */
const ALLOWED_SOURCE_UPDATES = new Set(["prospeccao"]);

/** Duas datas representam o mesmo instante?
 *
 * Comparar os textos não serve: o Postgres devolve
 * `2026-11-17T12:00:00+00:00` e a tela manda `2026-11-17T12:00:00.000Z`, que
 * é o mesmo momento escrito de dois jeitos. Com a comparação de texto, todo
 * salvamento da ficha registrava um evento "Reunião agendada para ..." novo,
 * mesmo sem ninguém ter mudado nada: o histórico de um lead de 17/11/2026
 * tinha seis eventos idênticos para a mesma reunião. Histórico que repete
 * deixa de ser histórico. */
function mesmoInstante(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  return !Number.isNaN(ta) && !Number.isNaN(tb) && ta === tb;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await hasValidSession())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const {
    status,
    notes,
    meeting_datetime,
    monthly_value,
    next_followup,
    city,
    category,
    source,
    outreach_language,
    remarketing_stage,
    confirmar_sem_contato,
    confirmar_sem_data,
  } = body as {
    status?: string;
    notes?: string;
    meeting_datetime?: string | null;
    monthly_value?: number | null;
    next_followup?: string | null;
    city?: string | null;
    category?: string | null;
    source?: string;
    outreach_language?: "en" | "pt" | null;
    remarketing_stage?: RemarketingStage | null;
    /** Ver a travessa de perda sem contato mais abaixo. */
    confirmar_sem_contato?: boolean;
    /** Ver a travessa de reuniao sem data mais abaixo. */
    confirmar_sem_data?: boolean;
  };

  const update: {
    status?: string;
    notes?: string;
    meeting_datetime?: string | null;
    monthly_value?: number | null;
    next_followup?: string | null;
    city?: string | null;
    category?: string | null;
    source?: string;
    status_dates?: Partial<Record<LeadStatus, string>>;
    outreach_language?: "en" | "pt" | null;
    remarketing_stage?: RemarketingStage | null;
  } = {};

  if (status !== undefined) {
    if (!STATUS_ORDER.includes(status as (typeof STATUS_ORDER)[number])) {
      return NextResponse.json({ error: "status inválido" }, { status: 400 });
    }
    update.status = status;
  }

  if (source !== undefined) {
    if (!ALLOWED_SOURCE_UPDATES.has(source)) {
      return NextResponse.json({ error: "source inválido" }, { status: 400 });
    }
    update.source = source;
  }

  if (notes !== undefined) {
    update.notes = notes;
  }

  if (meeting_datetime !== undefined) {
    if (meeting_datetime !== null && Number.isNaN(Date.parse(meeting_datetime))) {
      return NextResponse.json({ error: "meeting_datetime inválido" }, { status: 400 });
    }
    update.meeting_datetime = meeting_datetime;
  }

  if (monthly_value !== undefined) {
    if (
      monthly_value !== null &&
      (typeof monthly_value !== "number" || Number.isNaN(monthly_value) || monthly_value < 0)
    ) {
      return NextResponse.json({ error: "monthly_value inválido" }, { status: 400 });
    }
    update.monthly_value = monthly_value;
  }

  if (next_followup !== undefined) {
    if (next_followup !== null && Number.isNaN(Date.parse(next_followup))) {
      return NextResponse.json({ error: "next_followup inválido" }, { status: 400 });
    }
    update.next_followup = next_followup;
  }

  if (city !== undefined) update.city = city?.trim() || null;
  if (category !== undefined) update.category = category?.trim() || null;

  if (outreach_language !== undefined) {
    if (outreach_language !== null && outreach_language !== "en" && outreach_language !== "pt") {
      return NextResponse.json({ error: "outreach_language inválido" }, { status: 400 });
    }
    update.outreach_language = outreach_language;
  }

  if (remarketing_stage !== undefined) {
    if (
      remarketing_stage !== null &&
      !REMARKETING_STAGE_ORDER.includes(remarketing_stage as RemarketingStage)
    ) {
      return NextResponse.json({ error: "remarketing_stage inválido" }, { status: 400 });
    }
    update.remarketing_stage = remarketing_stage;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "nada para atualizar" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Busca o estado atual antes de atualizar, pra conseguir registrar um
  // histórico com "antes/depois" (best-effort — se essa consulta falhar,
  // seguimos com o update normalmente, só não geramos o evento).
  const { data: before } = await supabase
    .from("leads")
    .select(
      "status, notes, meeting_datetime, monthly_value, converted_to_client_id, external_key, status_dates, source, remarketing_stage"
    )
    .eq("id", id)
    .single();

  /* Travessa: dar um lead como perdido sem nunca ter falado com ele.
   *
   * Medido em 18/11/2026: dos 487 leads perdidos da base, 97 (20%) não têm
   * nenhum toque registrado, nem em `status_dates` nem na timeline. 94
   * vinham do Trello (o único canal que já fechou contrato) e 77 foram pra
   * "Finalizado" e não "Desqualificado" — tratados como "não fechou" sem
   * nunca ter havido uma conversa pra não fechar.
   *
   * A primeira medição deste comentário dizia 215, porque olhava só o
   * `status_dates`. Os 118 de diferença tinham mensagem na timeline. O
   * número menor é o certo, e é ele que justifica a travessa: 97 em 487
   * ainda é um em cada cinco.
   *
   * Não bloqueia, pede confirmação: perder sem contato é legítimo às vezes
   * (telefone errado, negócio fechado, fora do perfil) e leads antigos
   * podem ter sido trabalhados no Trello antes do CRM existir. O que não
   * pode é acontecer em silêncio. Quem confirma manda
   * `confirmar_sem_contato: true` e o motivo fica registrado no histórico.
   *
   * 409 (e não 400) porque o pedido está bem formado: é o estado do lead
   * que conflita com a mudança pedida. */
  const virandoPerda =
    status !== undefined &&
    before &&
    LOSS_STATUSES.includes(status as LeadStatus) &&
    !LOSS_STATUSES.includes(before.status as LeadStatus);

  /* Segunda fonte de prova de contato: a timeline.
   *
   * `status_dates` só é escrito quando o status muda, então ele não vê duas
   * coisas que de fato aconteceram: a mensagem inicial automática dos leads
   * vindos do Trello (gravada como `whatsapp_sent`) e a mensagem preparada
   * no compositor sem mudança de status (gravada como `note`). Medido em
   * 18/11/2026: dos 215 perdidos sem prova em `status_dates`, 118 tinham uma
   * dessas duas marcas. Sem nenhum toque mesmo eram 97.
   *
   * A consulta só roda quando o lead está virando perda, então o PATCH
   * normal continua com uma ida ao banco. */
  let houveMensagem = false;
  if (virandoPerda) {
    const { data: toques } = await supabase
      .from("lead_events")
      .select("id")
      .eq("lead_id", id)
      .or(`type.eq.whatsapp_sent,message.ilike.*${NOTA_MENSAGEM_PREPARADA}*`)
      .limit(1);
    houveMensagem = (toques?.length ?? 0) > 0;
  }

  const perdaSemContato =
    Boolean(virandoPerda) && nuncaFoiContatado(before?.status_dates, houveMensagem);

  if (perdaSemContato && !confirmar_sem_contato) {
    return NextResponse.json(
      {
        error: "Este lead nunca recebeu um contato registrado.",
        code: "perda_sem_contato",
      },
      { status: 409 }
    );
  }

  /* Travessa: entrar em "Reunião Marcada" sem data e hora.
   *
   * Medido em 17/11/2026: 20 das 25 reuniões da base não têm
   * `meeting_datetime`, e dos 15 no-shows, 13 estão sem data. Sem a data o
   * CRM fica cego exatamente onde ele mais serve: a Fila do Dia não sabe
   * que existe reunião hoje, o lembrete não sabe se é véspera ou mesmo dia,
   * e o aviso de confirmação nunca dispara. E confirmação é a única coisa
   * medida que separa 18% de no-show de 58%.
   *
   * Vale só pra ENTRADA no status. Quem já está em "Reunião Marcada" sem
   * data (os 20 de hoje) não é barrado a cada edição: esses aparecem na
   * coluna "Sem data" do quadro de Reuniões, que é onde se arruma. E
   * remover a data pela ficha do lead continua livre, porque ali é um ato
   * deliberado com o campo na frente, não um card arrastado sem perceber.
   *
   * Como a travessa de perda: não bloqueia, pede. Marcar reunião sem hora
   * combinada acontece ("ele aceitou, vamos ver o dia"), então existe a
   * saída de salvar sem data, e ela fica registrada no histórico. */
  const virandoReuniao =
    status !== undefined &&
    before &&
    status === "reuniao_marcada" &&
    before.status !== "reuniao_marcada";

  const dataFinalDaReuniao =
    meeting_datetime !== undefined ? meeting_datetime : (before?.meeting_datetime ?? null);

  const reuniaoSemData = Boolean(virandoReuniao) && !dataFinalDaReuniao;

  if (reuniaoSemData && !confirmar_sem_data) {
    return NextResponse.json(
      {
        error: "Reunião marcada sem data e hora.",
        code: "reuniao_sem_data",
      },
      { status: 409 }
    );
  }

  // Se o status está mudando de verdade, registra a data dessa transição em
  // `status_dates` e (a não ser que o pedido já tenha informado
  // `next_followup` explicitamente) agenda/limpa o próximo follow-up
  // automaticamente, seguindo os 48h combinados entre contatos — ver
  // lib/lead-status.ts.
  if (status !== undefined && before && before.status !== status) {
    const statusUpdate = buildStatusChangeUpdate(before.status_dates, status as LeadStatus, {
      explicitNextFollowup: next_followup !== undefined,
    });
    update.status_dates = statusUpdate.status_dates;
    if (statusUpdate.next_followup !== undefined) {
      update.next_followup = statusUpdate.next_followup;
    }
  }

  const { data, error } = await supabase
    .from("leads")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (before) {
    const events: { lead_id: string; type: string; message: string }[] = [];

    if (status !== undefined && before.status !== status) {
      const fromLabel = STATUS_LABELS[before.status as LeadStatus] ?? before.status;
      const toLabel = STATUS_LABELS[status as LeadStatus] ?? status;
      events.push({
        lead_id: id,
        type: "status_change",
        message: `Status alterado de "${fromLabel}" para "${toLabel}"`,
      });

      if (perdaSemContato) {
        events.push({
          lead_id: id,
          type: "note",
          message: `Dado como "${toLabel}" sem nenhum contato registrado no histórico (confirmado manualmente)`,
        });
      }

      if (reuniaoSemData) {
        events.push({
          lead_id: id,
          type: "note",
          message:
            "Reunião marcada sem data e hora definidas (confirmado manualmente)",
        });
      }

      if (next_followup === undefined && update.next_followup !== undefined) {
        events.push({
          lead_id: id,
          type: "note",
          message:
            update.next_followup === null
              ? "Follow-up pendente removido automaticamente (status de saída do funil de contato)"
              : `Follow-up automático agendado para ${new Date(`${update.next_followup}T00:00:00`).toLocaleDateString("pt-BR")} (${FOLLOWUP_INTERVAL_HOURS}h após este contato)`,
        });
      }

      // Sincronização reversa: se este lead veio do Trello (external_key
      // "trello:<id>"), move o card pra lista equivalente ao novo status.
      // Best-effort e nunca lança — não pode derrubar a resposta do PATCH
      // por causa de uma falha na API do Trello (ver lib/trello.ts).
      try {
        const trelloResult = await syncLeadStatusToTrello(before.external_key, status as LeadStatus);
        if (!trelloResult.ok) {
          console.error("Sync CRM->Trello falhou:", trelloResult.error);
        }
      } catch (err) {
        console.error("Erro inesperado ao chamar sync CRM->Trello:", err);
      }
    }

    if (source !== undefined && before.source !== source) {
      events.push({
        lead_id: id,
        type: "note",
        message: "Lead movido para Prospecção Ativa",
      });
    }

    if (notes !== undefined && (before.notes ?? "") !== notes) {
      events.push({
        lead_id: id,
        type: "note",
        message: notes ? "Observações atualizadas" : "Observações removidas",
      });
    }

    if (remarketing_stage !== undefined && before.remarketing_stage !== remarketing_stage) {
      events.push({
        lead_id: id,
        type: "note",
        message: remarketing_stage
          ? `Remarketing: ${REMARKETING_STAGE_LABELS[remarketing_stage as RemarketingStage]}`
          : "Remarketing: etapa removida",
      });
    }

    if (meeting_datetime !== undefined && !mesmoInstante(before.meeting_datetime, meeting_datetime)) {
      events.push({
        lead_id: id,
        type: "meeting",
        message: meeting_datetime
          ? `Reunião agendada para ${new Date(meeting_datetime).toLocaleString("pt-BR")}`
          : "Reunião removida",
      });
    }

    if (monthly_value !== undefined && before.monthly_value !== monthly_value) {
      events.push({
        lead_id: id,
        type: "value",
        message:
          monthly_value !== null
            ? `Valor mensal estimado: ${monthly_value.toLocaleString("pt-BR", {
                style: "currency",
                currency: "BRL",
              })}`
            : "Valor mensal removido",
      });
    }

    if (events.length > 0) {
      const { error: eventsError } = await supabase.from("lead_events").insert(events);
      if (eventsError) {
        // Histórico é "nice to have" — não falha a resposta principal por causa dele.
        console.error("Erro ao registrar histórico do lead:", eventsError.message);
      }
    }

    // Conversão automática: ao entrar em "Contrato Assinado" (equivalente ao
    // "fechado" da Evellyn), cadastra o Cliente automaticamente — sem botão
    // manual. Idempotente: só roda se o lead ainda não tiver sido convertido.
    if (
      status === "contrato_assinado" &&
      before.status !== "contrato_assinado" &&
      !before.converted_to_client_id
    ) {
      const { data: client, error: clientError } = await supabase
        .from("clients")
        .insert({
          full_name: (data.full_name ?? "").trim() || "Cliente sem nome",
          email: data.email,
          phone: data.phone,
          city: data.city,
          category: data.category,
          monthly_value: data.monthly_value,
          status: "ativo",
          source_lead_id: data.id,
        })
        .select()
        .single();

      if (clientError) {
        console.error("Erro ao converter lead em cliente automaticamente:", clientError.message);
      } else {
        const { error: updateLeadError } = await supabase
          .from("leads")
          .update({ converted_to_client_id: client.id })
          .eq("id", id);
        if (updateLeadError) {
          console.error("Erro ao marcar lead como convertido:", updateLeadError.message);
        } else {
          data.converted_to_client_id = client.id;
        }

        const { error: convEventError } = await supabase.from("lead_events").insert({
          lead_id: id,
          type: "status_change",
          message: "Cliente cadastrado automaticamente a partir deste lead",
        });
        if (convEventError) {
          console.error("Erro ao registrar evento de conversão:", convEventError.message);
        }
      }
    }
  }

  return NextResponse.json({ lead: data });
}
