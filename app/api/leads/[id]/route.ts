import { NextRequest, NextResponse } from "next/server";
import { hasValidSession } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { LeadStatus, STATUS_LABELS, STATUS_ORDER } from "@/lib/types";
import { syncLeadStatusToTrello } from "@/lib/trello";
import { buildStatusChangeUpdate, FOLLOWUP_INTERVAL_HOURS } from "@/lib/lead-status";

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
  } = body as {
    status?: string;
    notes?: string;
    meeting_datetime?: string | null;
    monthly_value?: number | null;
    next_followup?: string | null;
    city?: string | null;
    category?: string | null;
  };

  const update: {
    status?: string;
    notes?: string;
    meeting_datetime?: string | null;
    monthly_value?: number | null;
    next_followup?: string | null;
    city?: string | null;
    category?: string | null;
    status_dates?: Partial<Record<LeadStatus, string>>;
  } = {};

  if (status !== undefined) {
    if (!STATUS_ORDER.includes(status as (typeof STATUS_ORDER)[number])) {
      return NextResponse.json({ error: "status inválido" }, { status: 400 });
    }
    update.status = status;
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
      "status, notes, meeting_datetime, monthly_value, converted_to_client_id, external_key, status_dates"
    )
    .eq("id", id)
    .single();

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

    if (notes !== undefined && (before.notes ?? "") !== notes) {
      events.push({
        lead_id: id,
        type: "note",
        message: notes ? "Observações atualizadas" : "Observações removidas",
      });
    }

    if (meeting_datetime !== undefined && before.meeting_datetime !== meeting_datetime) {
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
