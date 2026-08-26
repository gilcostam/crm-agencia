import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { triggerWhatsappSequence } from "@/lib/whatsapp-automation";

/**
 * GET: handshake de verificação do webhook (Meta chama isso uma vez,
 * quando você configura a URL do webhook no painel do App).
 * https://developers.facebook.com/docs/graph-api/webhooks/getting-started
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;

  if (mode === "subscribe" && verifyToken && token === verifyToken) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }

  return new NextResponse("Forbidden", { status: 403 });
}

interface MetaLeadChangeValue {
  leadgen_id: string;
  form_id?: string;
  page_id?: string;
  ad_id?: string;
  adgroup_id?: string;
  created_time?: number;
}

interface MetaLeadChange {
  field: string;
  value: MetaLeadChangeValue;
}

interface MetaEntry {
  id: string;
  time: number;
  changes: MetaLeadChange[];
}

interface MetaWebhookBody {
  object: string;
  entry: MetaEntry[];
}

interface GraphLeadField {
  name: string;
  values: string[];
}

interface GraphLeadResponse {
  id: string;
  created_time?: string;
  field_data?: GraphLeadField[];
  ad_id?: string;
  ad_name?: string;
  campaign_name?: string;
  form_id?: string;
}

function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret || !signatureHeader) return false;

  const expected =
    "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");

  const sigBuffer = Buffer.from(signatureHeader);
  const expectedBuffer = Buffer.from(expected);
  if (sigBuffer.length !== expectedBuffer.length) return false;

  return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
}

async function fetchLeadFromGraphAPI(leadgenId: string): Promise<GraphLeadResponse> {
  const pageAccessToken = process.env.META_PAGE_ACCESS_TOKEN;
  if (!pageAccessToken) {
    throw new Error("Falta a variável de ambiente META_PAGE_ACCESS_TOKEN");
  }

  const url = `https://graph.facebook.com/v20.0/${leadgenId}?access_token=${encodeURIComponent(
    pageAccessToken
  )}&fields=field_data,ad_id,ad_name,campaign_name,form_id,created_time`;

  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Graph API respondeu ${response.status}: ${text}`);
  }

  return response.json();
}

function extractField(fieldData: GraphLeadField[], keys: string[]): string | null {
  for (const key of keys) {
    const field = fieldData.find((f) => f.name?.toLowerCase() === key);
    if (field?.values?.[0]) return field.values[0];
  }
  return null;
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  // Em ambiente de teste local (sem META_APP_SECRET configurado ainda) não
  // bloqueamos, mas em produção a assinatura deve sempre bater.
  if (process.env.META_APP_SECRET && !verifySignature(rawBody, signature)) {
    console.warn("Webhook Meta: assinatura inválida, requisição ignorada.");
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let body: MetaWebhookBody | null = null;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: true });
  }

  if (!body || body.object !== "page") {
    return NextResponse.json({ ok: true });
  }

  const supabase = createServiceClient();

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "leadgen") continue;

      const { leadgen_id, form_id, ad_id } = change.value;
      if (!leadgen_id) continue;

      // Verifica ANTES do upsert se esse leadgen_id já existia, para saber
      // se este é um lead novo (e portanto candidato ao disparo automático
      // da sequência de WhatsApp) ou apenas uma reentrega do webhook do Meta
      // para um lead que já processamos antes.
      const { data: existingLead } = await supabase
        .from("leads")
        .select("id")
        .eq("leadgen_id", leadgen_id)
        .maybeSingle();
      const isNewLead = !existingLead;

      // Por padrão, salvamos ao menos o que veio no próprio evento do
      // webhook. Isso garante que o lead NUNCA seja perdido, mesmo que a
      // chamada de enriquecimento à Graph API falhe (permissão, rate limit,
      // instabilidade, etc.) — o time consegue ver o lead no dashboard e
      // buscar os detalhes completos no Meta Business Suite se necessário.
      let leadRow: Record<string, unknown> = {
        leadgen_id,
        full_name: null,
        email: null,
        phone: null,
        city: null,
        form_name: form_id ?? null,
        ad_name: ad_id ?? null,
        campaign_name: null,
        source: "meta_ads",
        raw_payload: change.value,
        notes: "Dados completos não puderam ser buscados automaticamente na Graph API. Verifique no Meta Business Suite.",
      };

      try {
        const leadData = await fetchLeadFromGraphAPI(leadgen_id);
        const fieldData = leadData.field_data ?? [];

        const fullName = extractField(fieldData, ["full_name", "nome", "name"]);
        const email = extractField(fieldData, ["email"]);
        const phone = extractField(fieldData, [
          "phone_number",
          "telefone",
          "phone",
        ]);
        const city = extractField(fieldData, ["city", "cidade"]);

        leadRow = {
          leadgen_id,
          full_name: fullName,
          email,
          phone,
          city,
          form_name: leadData.form_id ?? form_id ?? null,
          ad_name: leadData.ad_name ?? ad_id ?? null,
          campaign_name: leadData.campaign_name ?? null,
          source: "meta_ads",
          raw_payload: leadData,
          notes: null,
        };
      } catch (err) {
        console.error(
          "Erro ao buscar lead na Graph API — salvando dados parciais do webhook:",
          err
        );
      }

      const { data: upsertedLead, error } = await supabase
        .from("leads")
        .upsert(leadRow, { onConflict: "leadgen_id" })
        .select("id, full_name, phone, city")
        .single();

      if (error) {
        console.error("Erro ao salvar lead no Supabase:", error.message);
        continue;
      }

      // Disparo automático da sequência de WhatsApp: só para leads
      // genuinamente novos (não reentregas do webhook do Meta) e que vieram
      // com telefone. Nunca deve derrubar a resposta 200 para o Meta — por
      // isso o try/catch extra, além do próprio contrato "nunca lança" de
      // triggerWhatsappSequence.
      if (isNewLead && upsertedLead?.phone) {
        try {
          await triggerWhatsappSequence(supabase, upsertedLead, "auto_meta_ads");
        } catch (err) {
          console.error(
            "Erro inesperado ao disparar sequência automática de WhatsApp para lead do Meta Ads:",
            err
          );
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}
