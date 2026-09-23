/**
 * Parser do upload de planilha (CSV) de contatos do Instagram, usado por
 * app/api/leads/import-instagram-sheet/route.ts pra alimentar a tela
 * "Prospecção Ativa" a partir de uma planilha (ex.: exportada do Google
 * Sheets/Excel com a lista de perfis já levantados pela equipe), em vez de
 * colar linha por linha (ver lib/instagram-import.ts pro fluxo de colagem de
 * texto, que continua existindo em paralelo).
 *
 * Não usa nenhuma lib de parsing de planilha (ver lib/csv.ts): suporta CSV
 * com cabeçalho, delimitador "," ou ";" (detectado automaticamente). Se o
 * arquivo for .xlsx, ele precisa ser exportado/salvo como CSV antes do
 * upload (Google Sheets e Excel fazem isso em "Arquivo > Fazer download" /
 * "Salvar como"). Optou-se por não usar a lib "xlsx" (SheetJS) porque ela
 * tem vulnerabilidades conhecidas sem correção disponível (prototype
 * pollution e ReDoS) e este parser recebe arquivo enviado pelo usuário.
 *
 * Cabeçalhos aceitos (case/acento-insensitive, ver COLUMN_ALIASES): a
 * planilha só precisa ter uma coluna reconhecível de perfil/handle do
 * Instagram; nome, categoria, cidade e telefone são opcionais.
 */

import { parseInstagramHandle } from "./instagram";
import { parseDelimited, toRecords, normalizeHeader, detectDelimiter } from "./csv";

export interface InstagramSheetLeadRow {
  external_key: string;
  full_name: string | null;
  instagram: string;
  category: string | null;
  city: string | null;
  phone: string | null;
  status: "novo_lead";
  source: "instagram";
  notes: string;
  raw_payload: {
    _origem: string;
    csv_row: Record<string, string>;
  };
}

export interface ParseInstagramSheetResult {
  rows: InstagramSheetLeadRow[];
  totalRows: number;
  skippedInvalid: number;
  mergedCount: number;
  /** false quando nenhuma coluna do cabeçalho bate com nenhum alias de
   * "handle" conhecido (ver COLUMN_ALIASES.handle) — sinal de que o arquivo
   * provavelmente não é o esperado, usado pra dar um erro mais claro do que
   * "0 leads encontrados". */
  handleColumnFound: boolean;
}

const COLUMN_ALIASES: Record<string, string[]> = {
  handle: [
    "instagram",
    "perfil",
    "perfil do instagram",
    "instagram (@)",
    "usuario",
    "usuario do instagram",
    "handle",
    "@",
    "link",
    "url",
    "link do instagram",
  ],
  full_name: ["nome", "empresa", "name", "cliente", "nome do lead", "razao social"],
  category: ["categoria", "nicho", "especialidade", "segmento"],
  city: ["cidade", "city", "municipio"],
  phone: ["telefone", "celular", "whatsapp", "phone", "fone", "numero"],
};

function pick(record: Record<string, string>, aliases: string[]): string {
  for (const alias of aliases) {
    if (alias in record) return (record[alias] ?? "").trim();
  }
  return "";
}

function toNormalizedRecords(rows: string[][]): Record<string, string>[] {
  if (rows.length === 0) return [];
  const header = rows[0].map(normalizeHeader);
  return rows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    header.forEach((key, i) => {
      // Mantém a primeira coluna em caso de cabeçalho duplicado.
      if (!(key in record)) record[key] = row[i] ?? "";
    });
    return record;
  });
}

function buildLeadRow(
  original: Record<string, string>,
  normalized: Record<string, string>
): InstagramSheetLeadRow | null {
  const rawHandle = pick(normalized, COLUMN_ALIASES.handle);
  const handle = parseInstagramHandle(rawHandle);
  if (!handle) return null;

  const fullName = pick(normalized, COLUMN_ALIASES.full_name);
  const category = pick(normalized, COLUMN_ALIASES.category);
  const city = pick(normalized, COLUMN_ALIASES.city);
  const phone = pick(normalized, COLUMN_ALIASES.phone);

  return {
    external_key: `instagram:${handle}`,
    full_name: fullName || null,
    instagram: handle,
    category: category || null,
    city: city || null,
    phone: phone || null,
    status: "novo_lead",
    source: "instagram",
    notes: "Prospecção ativa, perfil do Instagram importado via planilha (upload) pelo dashboard.",
    raw_payload: {
      _origem: "Importado via upload de planilha CSV (Prospecção Ativa > Importar planilha do Instagram).",
      csv_row: original,
    },
  };
}

/** Mesmo motivo do dedupe do TNG e do import por colagem de texto: o upsert
 * do Supabase rejeita o lote inteiro se duas linhas colidirem na mesma
 * external_key. Mantém a primeira ocorrência, aproveitando nome/categoria/
 * cidade/telefone preenchidos numa ocorrência posterior se a primeira
 * estiver vazia. */
function dedupeByExternalKey(rows: InstagramSheetLeadRow[]): {
  rows: InstagramSheetLeadRow[];
  mergedCount: number;
} {
  const seen = new Map<string, InstagramSheetLeadRow>();
  const order: string[] = [];
  let mergedCount = 0;

  for (const row of rows) {
    if (seen.has(row.external_key)) {
      mergedCount++;
      const existing = seen.get(row.external_key)!;
      existing.full_name ||= row.full_name;
      existing.category ||= row.category;
      existing.city ||= row.city;
      existing.phone ||= row.phone;
      continue;
    }
    seen.set(row.external_key, row);
    order.push(row.external_key);
  }

  return { rows: order.map((key) => seen.get(key)!), mergedCount };
}

export function parseInstagramSheetCsv(csvText: string): ParseInstagramSheetResult {
  const firstLine = csvText.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = detectDelimiter(firstLine);
  const rawRows = parseDelimited(csvText, delimiter);

  if (rawRows.length === 0) {
    return { rows: [], totalRows: 0, skippedInvalid: 0, mergedCount: 0, handleColumnFound: false };
  }

  const normalizedHeader = rawRows[0].map(normalizeHeader);
  const handleColumnFound = COLUMN_ALIASES.handle.some((alias) => normalizedHeader.includes(alias));

  const originalRecords = toRecords(rawRows);
  const normalizedRecords = toNormalizedRecords(rawRows);

  let skippedInvalid = 0;
  const built: InstagramSheetLeadRow[] = [];
  for (let i = 0; i < normalizedRecords.length; i++) {
    const row = buildLeadRow(originalRecords[i], normalizedRecords[i]);
    if (!row) {
      skippedInvalid++;
      continue;
    }
    built.push(row);
  }

  const { rows, mergedCount } = dedupeByExternalKey(built);

  return {
    rows,
    totalRows: originalRecords.length,
    skippedInvalid,
    mergedCount,
    handleColumnFound,
  };
}
