import { NextRequest, NextResponse } from "next/server";
import { hasValidSession } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { triggerWhatsappSequence } from "@/lib/whatsapp-automation";

/**
 * Dispara manualmente a sequência automática de WhatsApp (fluxo n8n "No
 * Limits - Disparo Automático Meta Leads") para um lead específico.
 *
 * A lógica de disparo em si é compartilhada com o disparo automático que
 * acontece assim que um lead novo chega via webhook do Meta Ads — ver
 * lib/whatsapp-automation.ts.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await hasValidSession())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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

  const result = await triggerWhatsappSequence(supabase, lead, "manual");

  if (!result.ok) {
    const status = result.error?.startsWith("N8N_WHATSAPP_WEBHOOK_URL") || result.error === "Lead não tem telefone cadastrado"
      ? 400
      : 502;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ ok: true });
}
