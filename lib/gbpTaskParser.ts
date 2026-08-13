import { ParsedClientTask, TaskCategory, TaskRecurrence } from "@/lib/types";

/**
 * Parser determinístico de tarefas a partir do texto de relatórios de Perfil
 * de Empresa no Google (formato gerado pela skill gbp-profile-builder /
 * ferramenta pesquisa.tngdigital.com.br). Não usa IA — é uma extração por
 * regex baseada em duas seções com padrão bem definido:
 *
 *  - "Plano de SEO local": bullets no formato
 *    "<prazo> — <descrição> (<responsável>)", onde <prazo> é "Imediato",
 *    "N dias" ou "Contínuo".
 *  - "Avaliações — mensagem de solicitação": bullets no formato
 *    "<descrição> — <responsável>", sem prazo explícito.
 *
 * Como é best-effort (documentos reais podem variar), o resultado é sempre
 * apresentado ao usuário para revisão antes de ser gravado no banco — ver
 * app/api/clients/[id]/tasks/import (preview) e .../tasks/bulk (commit).
 */

const KNOWN_RESPONSIBLES = ["Gilmara", "Cliente", "No Limits Marketing Estratégico"];

/**
 * Remove o rodapé de página repetido em cada página do PDF exportado (ex.:
 * "13/08/2026, 10:49  Perfil de Empresa no Google — <título>
 * blob:https://pesquisa.tngdigital.com.br/<uuid>  5/6" seguido de
 * "-- 5 of 6 --"). Sem isso, esse texto fica colado logo após o último
 * bullet de uma seção sempre que ela termina perto de uma quebra de página,
 * e quebra o lookahead de fechamento das regex de bullet abaixo — fazendo o
 * parser perder silenciosamente o último item da seção.
 */
function stripPageFooters(text: string): string {
  return text
    .replace(/\d{2}\/\d{2}\/\d{4},\s*\d{1,2}:\d{2}[\s\S]{0,300}?blob:https?:\/\/\S+\s*\d+\/\d+/g, " ")
    .replace(/--\s*\d+\s*of\s*\d+\s*--/gi, " ");
}

function normalize(text: string): string {
  // Extrações de PDF quebram linhas no meio de frases — juntamos tudo em
  // espaços e colapsamos espaços múltiplos antes de rodar as regex.
  return stripPageFooters(text.replace(/\r/g, ""))
    .replace(/\n+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function extractSection(fullText: string, startHeading: RegExp, endHeadings: RegExp[]): string | null {
  const startMatch = startHeading.exec(fullText);
  if (!startMatch) return null;
  const from = startMatch.index + startMatch[0].length;

  let endIndex = fullText.length;
  for (const endHeading of endHeadings) {
    endHeading.lastIndex = 0;
    const m = endHeading.exec(fullText.slice(from));
    if (m) {
      const candidate = from + m.index;
      if (candidate < endIndex) endIndex = candidate;
    }
  }

  return fullText.slice(from, endIndex).trim();
}

function addDays(base: Date, days: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Extrai os bullets do "Plano de SEO local": prazo — descrição (responsável). */
function parsePlanoSeoLocal(sectionText: string, anchorDate: Date): ParsedClientTask[] {
  const tasks: ParsedClientTask[] = [];
  const bulletPattern =
    /(Imediato|\d+\s*dias?|Cont[íi]nuo)\s*[—\-]\s*([\s\S]+?)\s*\(([^()]+)\)(?=\s*(?:Imediato|\d+\s*dias?|Cont[íi]nuo)\s*[—\-]|\s*$)/gi;

  let match: RegExpExecArray | null;
  while ((match = bulletPattern.exec(sectionText)) !== null) {
    const [, prazoRaw, description, responsibleRaw] = match;
    const prazo = prazoRaw.trim();
    const responsible = responsibleRaw.trim();

    let due_date: string | null = null;
    let recurrence: TaskRecurrence | null = null;

    if (/^imediato$/i.test(prazo)) {
      due_date = addDays(anchorDate, 0);
    } else if (/^cont[íi]nuo$/i.test(prazo)) {
      recurrence = "continuo";
    } else {
      const daysMatch = /(\d+)/.exec(prazo);
      if (daysMatch) due_date = addDays(anchorDate, Number(daysMatch[1]));
    }

    tasks.push({
      title: description.trim().replace(/\s+/g, " "),
      description: `Prazo original do plano: ${prazo}.`,
      category: "seo_local",
      responsible,
      due_date,
      recurrence,
    });
  }

  return tasks;
}

/** Extrai os bullets de "Avaliações — mensagem de solicitação": descrição — responsável. */
function parseAvaliacoes(sectionText: string): ParsedClientTask[] {
  const tasks: ParsedClientTask[] = [];
  const responsibleAlternation = KNOWN_RESPONSIBLES.map((r) =>
    r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  ).join("|");
  const bulletPattern = new RegExp(
    `([\\s\\S]+?)\\s*[—\\-]\\s*(${responsibleAlternation})(?=\\s+[A-ZÀ-Ú]|\\s*$)`,
    "g"
  );

  let match: RegExpExecArray | null;
  while ((match = bulletPattern.exec(sectionText)) !== null) {
    const [, descriptionRaw, responsible] = match;
    const description = descriptionRaw.trim().replace(/\s+/g, " ");
    if (!description) continue;

    const recurrence: TaskRecurrence | null = /\bmensal\b/i.test(description)
      ? "mensal"
      : /\bsemanal(?:mente)?\b/i.test(description)
        ? "semanal"
        : null;

    tasks.push({
      title: description,
      description: null,
      category: "avaliacoes",
      responsible,
      due_date: null,
      recurrence,
    });
  }

  return tasks;
}

/**
 * Ponto de entrada: recebe o texto bruto extraído do PDF (ex.: via
 * pdf-parse) e a data-âncora (a partir de quando contar "N dias") e retorna
 * as tarefas candidatas, já ordenadas por prazo (tarefas sem prazo/contínuas
 * por último).
 */
export function parseGbpReportTasks(rawText: string, anchorDate: Date = new Date()): ParsedClientTask[] {
  const text = normalize(rawText);

  const seoSection = extractSection(
    text,
    /Plano de SEO local/i,
    [/Fotos a produzir/i, /Diagn[óo]stico do perfil/i, /Onde mais cadastrar/i]
  );
  const avaliacoesSection = extractSection(
    text,
    /Avalia[çc][õo]es\s*[—\-]\s*mensagem de solicita[çc][ãa]o/i,
    [/Plano de SEO local/i, /Fotos a produzir/i]
  );

  const tasks: ParsedClientTask[] = [
    ...(seoSection ? parsePlanoSeoLocal(seoSection, anchorDate) : []),
    ...(avaliacoesSection ? parseAvaliacoes(avaliacoesSection) : []),
  ];

  tasks.sort((a, b) => {
    if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
    if (a.due_date) return -1;
    if (b.due_date) return 1;
    return 0;
  });

  return tasks;
}

export const GBP_CATEGORY: TaskCategory = "seo_local";
