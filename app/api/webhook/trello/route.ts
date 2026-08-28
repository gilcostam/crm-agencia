import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { triggerWhatsappSequence } from "@/lib/whatsapp-automation";

/**
 * Sincronização em tempo real com o board de prospecção no Trello.
 *
 * Fluxo:
 *  - HEAD: o Trello chama isso uma vez ao registrar o webhook, só pra
 *    confirmar que a URL responde 200. Precisa existir mesmo sem fazer nada.
 *  - POST: evento real (card criado/movido/editado). Buscamos o card
 *    completo na API do Trello (o payload do webhook não traz `desc`/`due`),
 *    extraímos os campos (mesmo parser usado em
 *    scripts/import_trello_leads.py) e fazemos upsert em `leads` usando
 *    `trello:<id do card>` como external_key — mesma chave usada pelo
 *    import manual, então os dois métodos não duplicam entre si.
 *
 *  - Disparo automático de WhatsApp: assim como o webhook do Meta Ads
 *    (app/api/webhook/meta/route.ts), quando este evento cria um lead
 *    GENUINAMENTE NOVO (não existia ainda pelo external_key) e o card já
 *    tem telefone preenchido, disparamos a sequência automática de
 *    WhatsApp (triggerWhatsappSequence) sem exigir clique manual. Esse é
 *    hoje o principal caminho de entrada de leads no CRM — antes deste
 *    ajuste, só o disparo manual pelo dashboard funcionava para leads
 *    vindos do Trello.
 */

const LIST_NAME_TO_STATUS: Record<string, string> = {
  "novo lead": "novo_lead",
  "primeiro contato": "primeiro_contato",
  "segundo contato": "segundo_contato",
  "terceiro contato": "terceiro_contato",
  "reunião marcada": "reuniao_marcada",
  "reuniao marcada": "reuniao_marcada",
  "diagnóstico enviado": "diagnostico_enviado",
  "diagnostico enviado": "diagnostico_enviado",
  finalizado: "finalizado",
  desqualificado: "desqualificado",
};

const RELEVANT_ACTION_TYPES = new Set([
  "createCard",
  "updateCard",
  "moveCardToBoard",
]);

function verifyTrelloSignature(
  rawBody: string,
  signatureHeader: string | null,
  callbackUrl: string
): boolean {
  const secret = process.env.TRELLO_API_SECRET;
  if (!secret || !signatureHeader) return false;

  const expected = crypto
    .createHmac("sha1", secret)
    .update(rawBody + callbackUrl)
    .digest("base64");

  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}

function parseDescFields(desc: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const pattern = /^\*\*([^*:]+):\*\*\s*(.*)$/;
  for (const rawLine of desc.split("\n")) {
    const match = pattern.exec(rawLine.trim());
    if (match) {
      fields[match[1].trim().toLowerCase()] = match[2].trim();
    }
  }
  return fields;
}

interface TrelloCard {
  id: string;
  name: string;
  desc?: string;
  due?: string | null;
  idList: string;
}

async function fetchCard(cardId: string): Promise<TrelloCard | null> {
  const key = process.env.TRELLO_API_KEY;
  const token = process.env.TRELLO_TOKEN;
  if (!key || !token) return null;

  const res = await fetch(
    `https://api.trello.com/1/cards/${cardId}?key=${key}&token=${token}&fields=id,name,desc,due,idList`
  );
  if (!res.ok) return null;
  return res.json();
}

async function fetchListName(listId: string): Promise<string> {
  const key = process.env.TRELLO_API_KEY;
  const token = process.env.TRELLO_TOKEN;
  if (!key || !token) return "";

  const res = await fetch(
    `https://api.trello.com/1/lists/${listId}?key=${key}&token=${token}&fields=name`
  );
  if (!res.ok) return "";
  const data = await res.json();
  return data.name ?? "";
}

/** Trello chama HEAD ao registrar o webhook, só pra checar se a URL existe. */
export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}

/** Alguns clientes de teste (curl, navegador) usam GET — respondemos OK também. */
export async function GET() {
  return NextResponse.json({ ok: true, service: "trello-webhook" });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-trello-webhook");
  const callbackUrl = `${request.nextUrl.origin}/api/webhook/trello`;

  // Mesmo padrão do webhook do Meta: se o segredo ainda não foi configurado,
  // não bloqueia (facilita testar antes de ter TRELLO_API_SECRET em mãos),
  // mas registra um aviso — em produção o segredo deve sempre estar setado.
  if (process.env.TRELLO_API_SECRET) {
    if (!verifyTrelloSignature(rawBody, signature, callbackUrl)) {
      console.warn("Webhook Trello: assinatura inválida, requisição ignorada.");
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
  } else {
    console.warn(
      "Webhook Trello: TRELLO_API_SECRET não configurado — assinatura não verificada."
    );
  }

  let body: { action?: { type?: string; data?: { card?: { id?: string } } } } | null =
    null;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: true });
  }

  const action = body?.action;
  if (!action?.type || !RELEVANT_ACTION_TYPES.has(action.type)) {
    return NextResponse.json({ ok: true });
  }

  const cardId = action.data?.card?.id;
  if (!cardId) {
    return NextResponse.json({ ok: true });
  }

  const card = await fetchCard(cardId);
  if (!card) {
    console.error(`Webhook Trello: falha ao buscar card ${cardId} na API do Trello.`);
    return NextResponse.json({ ok: true });
  }

  const listName = await fetchListName(card.idList);
  const normalizedList = listName.trim().toLowerCase();
  const status = LIST_NAME_TO_STATUS[normalizedList] ?? "novo_lead";

  const descFields = parseDescFields(card.desc ?? "");

  const notesParts: string[] = [];
  if (descFields["company"]) notesParts.push(`Empresa/Clínica: ${descFields["company"]}`);
  if (descFields["has google my business?"]) {
    notesParts.push(`Google Meu Negócio: ${descFields["has google my business?"]}`);
  }
  if (descFields["biggest challenge"]) {
    notesParts.push(`Maior desafio: ${descFields["biggest challenge"]}`);
  }
  notesParts.push(`Lista original no Trello: ${listName}`);

  const externalKey = `trello:${card.id}`;
  const supabase = createServiceClient();

  const { data: existing } = await supabase
    .from("leads")
    .select("id, status")
    .eq("external_key", externalKey)
    .maybeSingle();

  const row = {
    external_key: externalKey,
    full_name: descFields["name"] || card.name || null,
    phone: descFields["phone"] || null,
    city: descFields["city"] || null,
    category: descFields["specialty"] || null,
    status,
    source: "trello",
    notes: notesParts.join("\n") || null,
    meeting_datetime: status === "reuniao_marcada" ? card.due ?? null : null,
    raw_payload: {
      _origem: "Sincronizado via webhook do Trello (app/api/webhook/trello).",
      trello_card_id: card.id,
      trello_list_name: listName,
      trello_card: card,
    },
  };

  if (existing) {
    const { error } = await supabase.from("leads").update(row).eq("id", existing.id);
    if (error) {
      console.error("Webhook Trello: erro ao atualizar lead:", error.message);
      return NextResponse.json({ ok: true });
    }
    if (existing.status !== status) {
      await supabase.from("lead_events").insert({
        lead_id: existing.id,
        type: "status_change",
        message: `Status atualizado via Trello (lista "${listName}"): ${existing.status} → ${status}`,
      });
    }
  } else {
    const { data: inserted, error } = await supabase
      .from("leads")
      .insert(row)
      .select("id, full_name, phone, city, category")
      .single();
    if (error) {
      console.error("Webhook Trello: erro ao criar lead:", error.message);
      return NextResponse.json({ ok: true });
    }
    if (inserted) {
      await supabase.from("lead_events").insert({
        lead_id: inserted.id,
        type: "created",
        message: `Lead criado via sincronização em tempo real com o Trello (lista "${listName}").`,
      });

      // Disparo automático da sequência de WhatsApp: só para leads
      // genuinamente novos (não reentregas do webhook do Trello para um
      // card já sincronizado) e que já vieram com telefone preenchido no
      // card. Nunca deve derrubar a resposta 200 para o Trello — por isso
      // o try/catch extra, além do próprio contrato "nunca lança" de
      // triggerWhatsappSequence.
      if (inserted.phone) {
        try {
          await triggerWhatsappSequence(supabase, inserted, "auto_trello");
        } catch (err) {
          console.error(
            "Erro inesperado ao disparar sequência automática de WhatsApp para lead do Trello:",
            err
          );
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}
