import { NextRequest, NextResponse } from "next/server";
import { hasValidSession } from "@/lib/auth";
import { parseGbpReportTasks } from "@/lib/gbpTaskParser";

const MAX_SIZE = 15 * 1024 * 1024; // 15MB

/**
 * pdf-parse (via pdfjs-dist "legacy" build) tenta polyfillar DOMMatrix/
 * ImageData/Path2D usando o pacote nativo opcional @napi-rs/canvas. Esse
 * pacote é específico de plataforma (binário nativo) e nem sempre chega
 * corretamente no bundle de function do Vercel (build roda em Linux, o
 * binário resolvido localmente pode ser de outra plataforma) — quando ele
 * falha ao carregar, o pdfjs-dist segue em frente sem avisar de forma
 * fatal, mas código interno que faz `class X extends DOMMatrix` quebra na
 * avaliação do módulo com "ReferenceError: DOMMatrix is not defined".
 *
 * Como só usamos extração de texto (getText()), nunca renderização, não
 * precisamos de um canvas real — só que os globais existam como
 * construtores válidos. Por isso: (1) definimos stubs mínimos ANTES de
 * importar o pacote, e (2) usamos import() dinâmico, já que um `import`
 * estático no topo do arquivo seria avaliado antes de qualquer código
 * nosso rodar, tornando os stubs inúteis.
 */
async function loadPdfParse() {
  const g = globalThis as unknown as Record<string, unknown>;
  if (typeof g.DOMMatrix === "undefined") {
    g.DOMMatrix = class DOMMatrix {};
  }
  if (typeof g.ImageData === "undefined") {
    g.ImageData = class ImageData {};
  }
  if (typeof g.Path2D === "undefined") {
    g.Path2D = class Path2D {};
  }
  /**
   * pdfjs-dist roda em modo "fake worker" no Node (não há Web Worker de
   * verdade) e, por padrão, tenta carregar o script do worker via um
   * import() dinâmico com caminho relativo ("./pdf.worker.mjs") resolvido a
   * partir do próprio chunk bundlado do pacote — chunk esse que não tem
   * esse arquivo do lado (Turbopack empacota cada módulo em um chunk
   * próprio). Isso derruba a extração com "Setting up fake worker failed:
   * Cannot find module .../pdf.worker.mjs".
   *
   * Import explícito do módulo do worker aqui, registrado em
   * `globalThis.pdfjsWorker`, faz o pdfjs-dist pular esse carregamento
   * dinâmico frágil (ele primeiro checa `globalThis.pdfjsWorker
   * ?.WorkerMessageHandler` antes de tentar resolver `workerSrc`) — ver
   * `PDFWorker.#mainThreadWorkerMessageHandler` em pdfjs-dist. Como aqui é
   * um import estático de um subpath real do pacote, o bundler consegue
   * rastrear e incluir o arquivo tanto em dev quanto no build de produção.
   */
  if (typeof g.pdfjsWorker === "undefined") {
    g.pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  }

  const mod = await import("pdf-parse");
  return mod.PDFParse;
}

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
    const PDFParse = await loadPdfParse();
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
