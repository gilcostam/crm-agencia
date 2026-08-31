import { NextRequest, NextResponse } from "next/server";
import { hasValidSession } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { parseTngCsv } from "@/lib/tng-csv";

/** Upload de CSV exportado da aba "Maps" do TNG Pesquisa direto pelo
 * dashboard (tela "Prospecção Ativa") — equivalente, via UI, ao que
 * scripts/import_tng_leads.py faz rodando localmente. Recebe multipart/
 * form-data com o arquivo no campo "file". */
export async function POST(request: NextRequest) {
  if (!(await hasValidSession())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Envie o arquivo CSV no campo 'file'" }, { status: 400 });
  }

  if (!file.name.toLowerCase().endsWith(".csv")) {
    return NextResponse.json({ error: "O arquivo precisa ser um .csv" }, { status: 400 });
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

  const { rows, totalRows, skippedNoPhone, mergedCount } = parseTngCsv(csvText);

  if (rows.length === 0) {
    return NextResponse.json(
      {
        error:
          "Nenhum lead com telefone encontrado nesse CSV — confira se é o arquivo certo (baixado da aba Maps do TNG Pesquisa).",
        totalRows,
        skippedNoPhone,
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
    skippedNoPhone,
    mergedCount,
    imported: data?.length ?? rows.length,
  });
}
