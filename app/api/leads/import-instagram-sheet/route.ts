import { NextRequest, NextResponse } from "next/server";
import { hasValidSession } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { parseInstagramSheetCsv } from "@/lib/instagram-sheet-import";

/** Upload de planilha (CSV) de contatos do Instagram direto pelo dashboard
 * (tela "Prospecção Ativa") — alternativa ao import por colagem de texto
 * (ver app/api/leads/import-instagram/route.ts) pra quem já tem a lista de
 * perfis levantada numa planilha (Google Sheets/Excel exportado como CSV).
 * Recebe multipart/form-data com o arquivo no campo "file". */
export async function POST(request: NextRequest) {
  if (!(await hasValidSession())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Envie o arquivo no campo 'file'" }, { status: 400 });
  }

  if (!file.name.toLowerCase().endsWith(".csv")) {
    return NextResponse.json(
      {
        error:
          "O arquivo precisa ser um .csv. Se sua planilha estiver em .xlsx, exporte/salve como CSV antes de enviar (Arquivo > Fazer download > Valores separados por vírgula, no Google Sheets, ou Salvar como > CSV, no Excel).",
      },
      { status: 400 }
    );
  }

  let csvText: string;
  try {
    const buffer = await file.arrayBuffer();
    csvText = Buffer.from(buffer).toString("utf-8");
  } catch {
    return NextResponse.json({ error: "Não foi possível ler o arquivo" }, { status: 400 });
  }

  if (!csvText.trim()) {
    return NextResponse.json({ error: "Arquivo CSV vazio" }, { status: 400 });
  }

  const { rows, totalRows, skippedInvalid, mergedCount, handleColumnFound } =
    parseInstagramSheetCsv(csvText);

  if (!handleColumnFound) {
    return NextResponse.json(
      {
        error:
          "Não encontrei uma coluna de perfil/Instagram nesse arquivo. A planilha precisa ter uma coluna chamada, por exemplo, 'instagram', 'perfil' ou 'link' com a URL ou @handle de cada lead.",
        totalRows,
      },
      { status: 400 }
    );
  }

  if (rows.length === 0) {
    return NextResponse.json(
      {
        error:
          "Nenhum perfil válido encontrado nessa planilha — confira se a coluna de Instagram tem a URL do perfil (ex.: instagram.com/fulano) ou @handle em cada linha.",
        totalRows,
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
    totalRows,
    skippedInvalid,
    mergedCount,
    imported: data?.length ?? rows.length,
  });
}
