import { NextRequest, NextResponse } from "next/server";
import { hasValidSession } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Cria um Cliente a partir de um lead "contrato_assinado", pré-preenchendo os
 * dados já coletados no funil. Idempotente: se o lead já tiver sido
 * convertido antes (converted_to_client_id preenchido), devolve o cliente
 * existente em vez de criar um duplicado.
 *
 * Normalmente a conversão acontece automaticamente ao mudar o status do lead
 * para "contrato_assinado" (ver PATCH em app/api/leads/[id]/route.ts) — esta
 * rota existe como um gatilho manual de reforço (ex: leads importados
 * diretamente no banco já com status contrato_assinado, sem passar pelo PATCH).
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

  if (lead.converted_to_client_id) {
    const { data: existingClient, error: existingError } = await supabase
      .from("clients")
      .select("*")
      .eq("id", lead.converted_to_client_id)
      .single();
    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }
    return NextResponse.json({ client: existingClient, alreadyConverted: true });
  }

  const name = (lead.full_name ?? "").trim() || "Cliente sem nome";

  const { data: client, error: clientError } = await supabase
    .from("clients")
    .insert({
      full_name: name,
      email: lead.email,
      phone: lead.phone,
      city: lead.city,
      category: lead.category,
      monthly_value: lead.monthly_value,
      status: "ativo",
      source_lead_id: lead.id,
    })
    .select()
    .single();

  if (clientError) {
    return NextResponse.json({ error: clientError.message }, { status: 500 });
  }

  const { error: updateLeadError } = await supabase
    .from("leads")
    .update({ converted_to_client_id: client.id })
    .eq("id", lead.id);

  if (updateLeadError) {
    // Não falha a resposta principal — cliente já foi criado com sucesso,
    // só o vínculo de rastreabilidade no lead que não gravou.
    console.error("Erro ao marcar lead como convertido:", updateLeadError.message);
  }

  return NextResponse.json({ client }, { status: 201 });
}
