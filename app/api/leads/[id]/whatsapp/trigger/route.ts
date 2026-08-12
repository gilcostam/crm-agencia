import { NextRequest, NextResponse } from "next/server";
import { hasValidSession } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Dispara manualmente a sequência automática de WhatsApp (fluxo n8n "No
 * Limits - Disparo Automático Meta Leads") para um lead específico.
 *
 * O payload segue o mesmo formato esperado pelo nó "Normalizar dados do
 * lead" do fluxo (arquivo Automação WhatsApp/fluxo_nolimits_leads.json):
 * nome, telefone, cidade.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await hasValidSession())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const webhookUrl = process.env.N8N_WHATSAPP_WEBHOOK_URL;
  if (!webhookUrl) {
    return NextResponse.json(
      {
        error:
          "N8N_WHATSAPP_WEBHOOK_URL não configurada no servidor. Configure essa variável de ambiente com a URL do webhook do fluxo n8n antes de disparar sequências.",
      },
      { status: 400 }
    );
  }

  const { id } = await params;
  const supabase = createServiceClient();

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .single();

  if (leadError || !lead) {
    return NextResponse.json({ error: leadError?.message ?? "Lead não encontrado" }, { status: 404 });
  }

  if (!lead.phone) {
    return NextResponse.json({ error: "Lead não tem telefone cadastrado" }, { status: 400 });
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: lead.full_name,
        telefone: lead.phone,
        cidade: lead.city,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return NextResponse.json(
        { error: `Fluxo n8n respondeu ${response.status}: ${text || "erro desconhecido"}` },
        { status: 502 }
      );
    }
  } catch (err) {
    return NextResponse.json(
      { error: `Erro de conexão com o fluxo n8n: ${err instanceof Error ? err.message : "erro desconhecido"}` },
      { status: 502 }
    );
  }

  const { error: eventError } = await supabase.from("lead_events").insert({
    lead_id: id,
    type: "whatsapp_sent",
    message: "Sequência automática disparada manualmente",
  });
  if (eventError) {
    console.error("Erro ao registrar evento de disparo de WhatsApp:", eventError.message);
  }

  return NextResponse.json({ ok: true });
}
