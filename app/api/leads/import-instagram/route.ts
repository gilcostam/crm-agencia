import { NextRequest, NextResponse } from "next/server";
import { hasValidSession } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { parseInstagramBulkText } from "@/lib/instagram-import";

/** Import em lote de leads de Instagram direto pelo dashboard (tela
 * "Prospecção Ativa") — recebe um texto colado com um perfil/handle por
 * linha (ver lib/instagram-import.ts pro formato aceito) e faz upsert na
 * tabela leads, deduplicando por external_key. Não envia nenhuma mensagem —
 * só cadastra os leads; o envio da abordagem continua sendo um passo manual
 * feito pelo usuário (ver InstagramComposerModal). */
export async function POST(request: NextRequest) {
  if (!(await hasValidSession())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { text } = body as { text?: string };

  if (!text || !text.trim()) {
    return NextResponse.json(
      { error: "Cole ao menos uma URL ou @handle do Instagram" },
      { status: 400 }
    );
  }

  const { rows, totalLines, skippedInvalid, mergedCount } = parseInstagramBulkText(text);

  if (rows.length === 0) {
    return NextResponse.json(
      {
        error:
          "Nenhum perfil válido encontrado — cole a URL do perfil (ex.: instagram.com/fulano) ou @handle, um por linha.",
        totalLines,
        skippedInvalid,
      },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("leads")
    .upsert(rows, { onConflict: "external_key" })
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    totalLines,
    skippedInvalid,
    mergedCount,
    imported: data?.length ?? rows.length,
  });
}
