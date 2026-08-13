import { NextRequest, NextResponse } from "next/server";
import { PDFParse } from "pdf-parse";
import { hasValidSession } from "@/lib/auth";
import { parseGbpReportTasks } from "@/lib/gbpTaskParser";

const MAX_SIZE = 15 * 1024 * 1024; // 15MB

/**
 * Extrai o texto de um PDF enviado (ex.: relatório de Perfil de Empresa no
 * Google) e retorna as tarefas candidatas identificadas. NÃO grava nada no
 * banco — é só o preview. A confirmação (com eventuais ajustes feitos pelo
 * usuário) é enviada para POST /api/clients/[id]/tasks/bulk.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await hasValidSession())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // params não é usado na extração em si, mas mantemos a rota aninhada em
  // /clients/[id]/ por consistência com o resto da API (e para uma futura
  // extensão que precise do cliente durante o parse).
  await params;

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  const anchorDateRaw = formData?.get("anchor_date");

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "arquivo não enviado" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "arquivo maior que 15MB" }, { status: 400 });
  }
  if (file.type && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "apenas arquivos PDF são suportados por enquanto" }, { status: 400 });
  }

  const anchorDate =
    typeof anchorDateRaw === "string" && anchorDateRaw && !Number.isNaN(Date.parse(anchorDateRaw))
      ? new Date(anchorDateRaw)
      : new Date();

  let text: string;
  try {
    const arrayBuffer = await file.arrayBuffer();
    const parser = new PDFParse({ data: new Uint8Array(arrayBuffer) });
    try {
      const result = await parser.getText();
      text = result.text;
    } finally {
      await parser.destroy();
    }
  } catch (err) {
    return NextResponse.json(
      { error: `Falha ao ler o PDF: ${err instanceof Error ? err.message : "erro desconhecido"}` },
      { status: 422 }
    );
  }

  const tasks = parseGbpReportTasks(text, anchorDate);

  if (tasks.length === 0) {
    return NextResponse.json(
      {
        tasks: [],
        warning:
          "Não identificamos automaticamente nenhuma tarefa nesse documento (esperamos o formato de relatório de Perfil de Empresa no Google, com seções 'Plano de SEO local' e/ou 'Avaliações'). Você pode adicionar as tarefas manualmente.",
      },
      { status: 200 }
    );
  }

  return NextResponse.json({ tasks, source_document: file.name, anchor_date: anchorDate.toISOString().slice(0, 10) });
}
