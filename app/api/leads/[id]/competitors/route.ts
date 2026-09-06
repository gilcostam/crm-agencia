import { NextRequest, NextResponse } from "next/server";
import { hasValidSession } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { checkLeadGoogleProfile, searchCompetitors } from "@/lib/serper";

/**
 * Busca, via Serper.dev, quem aparece na frente do lead no Google/Google
 * Maps para a categoria + cidade dele. Automatiza o preenchimento manual
 * dos campos `concorrente` / `avaliacoes_concorrente` usados no template
 * de WhatsApp "diagnostico_ia" (ver lib/whatsapp-templates.ts).
 *
 * Também checa se o próprio lead tem um perfil encontrável no Google (ver
 * checkLeadGoogleProfile): não ter perfil não é um erro, é um dado a mais
 * pro vendedor usar na conversa, então essa checagem nunca derruba a
 * resposta mesmo se falhar sozinha (best-effort, campo `leadProfile: null`
 * se não foi possível checar).
 */
export async function GET(
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
    .select("id, full_name, category, city")
    .eq("id", id)
    .single();

  if (leadError || !lead) {
    return NextResponse.json({ error: leadError?.message ?? "Lead não encontrado" }, { status: 404 });
  }

  if (!lead.category || !lead.city) {
    return NextResponse.json(
      { error: "Lead não tem categoria e/ou cidade cadastrada, necessárias pra buscar concorrentes." },
      { status: 400 }
    );
  }

  const result = await searchCompetitors(lead.category, lead.city, lead.full_name);

  if (!result.ok) {
    const status = result.error.startsWith("SERPER_API_KEY") ? 400 : 502;
    return NextResponse.json({ error: result.error }, { status });
  }

  // Best-effort: se o lead não tiver nome cadastrado, ou essa checagem
  // falhar por qualquer motivo, seguimos sem ela em vez de derrubar a busca
  // de concorrentes (que já é o valor principal da resposta).
  let leadProfile: Awaited<ReturnType<typeof checkLeadGoogleProfile>> | null = null;
  if (lead.full_name) {
    const profileResult = await checkLeadGoogleProfile(lead.full_name, lead.city);
    if (profileResult.ok) leadProfile = profileResult;
  }

  return NextResponse.json({ ...result, leadProfile });
}
