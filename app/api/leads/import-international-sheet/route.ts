import { NextRequest, NextResponse } from "next/server";
import { hasValidSession } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { parseInternationalSheetCsv } from "@/lib/international-sheet-import";

/** Upload de planilha (CSV) de leads dos EUA/Canadá pelo dashboard (tela
 * "Prospecção EUA/Canadá") — mesmo espírito de
 * app/api/leads/import-instagram-sheet/route.ts, só que os leads aqui não
 * precisam de Instagram: nome, telefone ou Instagram já bastam (ver
 * lib/international-sheet-import.ts). Recebe multipart/form-data com o
 * arquivo no campo "file". */
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
          "O arquivo precisa ser um .csv. Se sua planilha estiver em .xlsx, exporte/salve como CSV antes de enviar (File > Download > Comma Separated Values, no Google Sheets, ou Save As > CSV, no Excel).",
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

  const { rows, totalRows, skippedInvalid, mergedCount, identifierColumnFound } =
    parseInternationalSheetCsv(csvText);

  if (!identifierColumnFound) {
    return NextResponse.json(
      {
        error:
          "Não encontrei uma coluna de nome, telefone ou Instagram nesse arquivo. A planilha precisa ter pelo menos uma coluna chamada, por exemplo, 'name', 'phone' ou 'instagram'.",
        totalRows,
      },
      { status: 400 }
    );
  }

  if (rows.length === 0) {
    return NextResponse.json(
      {
        error:
          "Nenhum lead válido encontrado nessa planilha — confira se cada linha tem pelo menos nome, telefone ou Instagram preenchido.",
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
