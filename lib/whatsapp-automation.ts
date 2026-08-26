import { SupabaseClient } from "@supabase/supabase-js";

/**
 * Dispara a sequência automática de WhatsApp (fluxo n8n "No Limits - Disparo
 * Automático Meta Leads") para um lead específico.
 *
 * O payload segue o mesmo formato esperado pelo nó "Normalizar dados do
 * lead" do fluxo (arquivo Automação WhatsApp/fluxo_nolimits_leads.json):
 * nome, telefone, cidade.
 *
 * Usada tanto pelo disparo manual (botão no dashboard) quanto pelo disparo
 * automático (assim que um lead novo chega via webhook do Meta Ads).
 *
 * Nunca lança exceção — sempre retorna { ok, error? } e loga no console em
 * caso de falha. Isso é essencial no caminho automático: o webhook do Meta
 * precisa responder rápido e não pode quebrar por causa de uma falha no n8n.
 */
export async function triggerWhatsappSequence(
  supabase: SupabaseClient,
  lead: {
    id: string;
    full_name: string | null;
    phone: string | null;
    city: string | null;
  },
  trigger: "manual" | "auto_meta_ads"
): Promise<{ ok: boolean; error?: string }> {
  const webhookUrl = process.env.N8N_WHATSAPP_WEBHOOK_URL;
  if (!webhookUrl) {
    const error =
      "N8N_WHATSAPP_WEBHOOK_URL não configurada no servidor. Configure essa variável de ambiente com a URL do webhook do fluxo n8n antes de disparar sequências.";
    console.warn(`triggerWhatsappSequence (${trigger}): ${error}`);
    return { ok: false, error };
  }

  if (!lead.phone) {
    const error = "Lead não tem telefone cadastrado";
    console.warn(`triggerWhatsappSequence (${trigger}): ${error} (lead ${lead.id})`);
    return { ok: false, error };
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
      const error = `Fluxo n8n respondeu ${response.status}: ${text || "erro desconhecido"}`;
      console.error(`triggerWhatsappSequence (${trigger}): ${error} (lead ${lead.id})`);
      return { ok: false, error };
    }
  } catch (err) {
    const error = `Erro de conexão com o fluxo n8n: ${err instanceof Error ? err.message : "erro desconhecido"}`;
    console.error(`triggerWhatsappSequence (${trigger}): ${error} (lead ${lead.id})`);
    return { ok: false, error };
  }

  const message =
    trigger === "auto_meta_ads"
      ? "Sequência automática disparada automaticamente ao receber lead via Meta Ads"
      : "Sequência automática disparada manualmente";

  const { error: eventError } = await supabase.from("lead_events").insert({
    lead_id: lead.id,
    type: "whatsapp_sent",
    message,
  });
  if (eventError) {
    console.error(
      `triggerWhatsappSequence (${trigger}): erro ao registrar evento de disparo de WhatsApp:`,
      eventError.message
    );
  }

  return { ok: true };
}
