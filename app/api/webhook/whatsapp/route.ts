import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { sanitizePhone } from "@/lib/phone";
import { buildStatusChangeUpdate } from "@/lib/lead-status";

/**
 * Callback do fluxo n8n / Evolution API: recebe confirmação de que uma
 * mensagem da sequência automática foi enviada, ou que o lead respondeu.
 *
 * Autenticação: header `X-Webhook-Secret` deve bater com
 * WHATSAPP_WEBHOOK_SECRET (segredo compartilhado — não é OAuth nem
 * assinatura HMAC, só um valor secreto simples, adequado para uma chamada
 * server-to-server entre o n8n e este endpoint).
 *
 * Payload esperado: { lead_id?: string, phone?: string, type: 'sent' | 'reply', message?: string }
 * Um dos dois (lead_id ou phone) deve ser informado para localizar o lead.
 */

function safeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) return false;
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

export async function POST(request: NextRequest) {
  const expectedSecret = process.env.WHATSAPP_WEBHOOK_SECRET;
  if (!expectedSecret) {
    return NextResponse.json(
      { error: "WHATSAPP_WEBHOOK_SECRET não configurada no servidor." },
      { status: 500 }
    );
  }

  const providedSecret = request.headers.get("x-webhook-secret") ?? "";
  if (!providedSecret || !safeEqual(providedSecret, expectedSecret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { lead_id, phone, type, message } = body as {
    lead_id?: string;
    phone?: string;
    type?: string;
    message?: string;
  };

  if (type !== "sent" && type !== "reply") {
    return NextResponse.json({ error: "type deve ser 'sent' ou 'reply'" }, { status: 400 });
  }

  if (!lead_id && !phone) {
    return NextResponse.json({ error: "Informe lead_id ou phone" }, { status: 400 });
  }

  const supabase = createServiceClient();

  let leadId = lead_id ?? null;
  let leadStatus: string | null = null;
  let leadStatusDates: unknown = null;

  if (leadId) {
    const { data: lead } = await supabase
      .from("leads")
      .select("id, status, status_dates")
      .eq("id", leadId)
      .single();
    if (!lead) {
      return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });
    }
    leadStatus = lead.status;
    leadStatusDates = lead.status_dates;
  } else if (phone) {
    const digits = sanitizePhone(phone);
    if (!digits) {
      return NextResponse.json({ error: "phone inválido" }, { status: 400 });
    }
    // Busca por sufixo: o telefone salvo no lead pode não estar 100%
    // normalizado (com/sem +, com/sem DDI), então comparamos os últimos
    // dígitos que identificam o número de forma confiável.
    const suffix = digits.slice(-10);
    const { data: candidates } = await supabase
      .from("leads")
      .select("id, status, phone, status_dates")
      .ilike("phone", `%${suffix}%`)
      .is("merged_into_lead_id", null)
      .order("created_at", { ascending: false })
      .limit(1);

    if (!candidates || candidates.length === 0) {
      return NextResponse.json({ error: "Nenhum lead encontrado para esse telefone" }, { status: 404 });
    }
    leadId = candidates[0].id;
    leadStatus = candidates[0].status;
    leadStatusDates = candidates[0].status_dates;
  }

  if (!leadId) {
    return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });
  }

  const eventType = type === "sent" ? "whatsapp_sent" : "whatsapp_reply";
  const eventMessage =
    message?.trim() || (type === "sent" ? "Mensagem da sequência automática enviada" : "Lead respondeu no WhatsApp");

  const { error: eventError } = await supabase.from("lead_events").insert({
    lead_id: leadId,
    type: eventType,
    message: eventMessage,
  });
  if (eventError) {
    return NextResponse.json({ error: eventError.message }, { status: 500 });
  }

  // Se for o primeiro envio automático e o lead ainda estiver "novo_lead",
  // avança automaticamente para "primeiro_contato".
  if (type === "sent" && leadStatus === "novo_lead") {
    const { count } = await supabase
      .from("lead_events")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", leadId)
      .eq("type", "whatsapp_sent");

    if ((count ?? 0) <= 1) {
      const statusUpdate = buildStatusChangeUpdate(leadStatusDates, "primeiro_contato");
      const { error: updateError } = await supabase
        .from("leads")
        .update({
          status: statusUpdate.status,
          status_dates: statusUpdate.status_dates,
          ...(statusUpdate.next_followup !== undefined
            ? { next_followup: statusUpdate.next_followup }
            : {}),
        })
        .eq("id", leadId);
      if (updateError) {
        console.error("Erro ao avançar status do lead para 'primeiro_contato':", updateError.message);
      } else {
        const events = [
          {
            lead_id: leadId,
            type: "status_change",
            message: 'Status alterado de "Novo Lead" para "Primeiro Contato" (primeiro envio automático de WhatsApp)',
          },
        ];
        if (statusUpdate.next_followup) {
          events.push({
            lead_id: leadId,
            type: "note",
            message: `Follow-up automático agendado para ${new Date(`${statusUpdate.next_followup}T00:00:00`).toLocaleDateString("pt-BR")} (48h após este contato)`,
          });
        }
        const { error: statusEventError } = await supabase.from("lead_events").insert(events);
        if (statusEventError) {
          console.error("Erro ao registrar evento de status:", statusEventError.message);
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}
