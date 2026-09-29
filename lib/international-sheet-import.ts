/**
 * Parser do upload de planilha (CSV) de leads dos EUA/Canadá, usado por
 * app/api/leads/import-international-sheet/route.ts pra alimentar a tela
 * "Prospecção EUA/Canadá" (app/dashboard/prospeccao/internacional/page.tsx)
 * a partir de uma planilha já levantada pela equipe (ex.: Google
 * Sheets/Excel exportado como CSV) — mesmo espírito de
 * lib/instagram-sheet-import.ts, só que com colunas em inglês e sem exigir
 * Instagram (o canal principal desses leads é o WhatsApp/telefone).
 *
 * Mesma decisão de segurança de lib/instagram-sheet-import.ts: não usa
 * nenhuma lib de parsing de planilha (xlsx/SheetJS tem vulnerabilidades sem
 * correção — prototype pollution e ReDoS — e este parser recebe arquivo
 * enviado pelo usuário). Suporta só CSV, com cabeçalho, delimitador ","
 * ou ";" detectado automaticamente (ver lib/csv.ts); um .xlsx precisa ser
 * exportado/salvo como CSV antes do upload.
 *
 * Cabeçalhos aceitos (case/acento-insensitive, ver COLUMN_ALIASES). A
 * planilha precisa ter pelo menos uma coluna reconhecível de nome, telefone
 * ou Instagram pra cada linha virar um lead (ver buildLeadRow) — o resto é
 * opcional.
 */

import { sanitizeInternationalPhone } from "./international-phone";
import { parseInstagramHandle } from "./instagram";
import { parseDelimited, toRecords, normalizeHeader, detectDelimiter } from "./csv";

export interface InternationalSheetLeadRow {
  external_key: string;
  full_name: string | null;
  phone: string | null;
  instagram: string | null;
  category: string | null;
  city: string | null;
  status: "novo_lead";
  source: "internacional";
  notes: string;
  raw_payload: {
    _origem: string;
    csv_row: Record<string, string>;
  };
}

export interface ParseInternationalSheetResult {
  rows: InternationalSheetLeadRow[];
  totalRows: number;
  skippedInvalid: number;
  mergedCount: number;
  /** false quando nenhuma coluna do cabeçalho bate com nenhum alias de nome,
   * telefone ou Instagram — sinal de que o arquivo provavelmente não é o
   * esperado, usado pra dar um erro mais claro do que "0 leads encontrados". */
  identifierColumnFound: boolean;
}

const COLUMN_ALIASES: Record<string, string[]> = {
  full_name: [
    "name",
    "business",
    "business name",
    "company",
    "company name",
    "lead",
    "nome",
    "empresa",
  ],
  phone: ["phone", "phone number", "whatsapp", "cell", "mobile", "number", "telefone"],
  instagram: ["instagram", "ig", "instagram handle", "profile", "handle", "@"],
  category: ["category", "industry", "niche", "segment", "categoria"],
  city: ["city", "cidade"],
  state: ["state", "province", "estado"],
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
): InternationalSheetLeadRow | null {
  const fullName = pick(normalized, COLUMN_ALIASES.full_name);
  const rawPhone = pick(normalized, COLUMN_ALIASES.phone);
  const phone = sanitizeInternationalPhone(rawPhone);
  const rawHandle = pick(normalized, COLUMN_ALIASES.instagram);
  const handle = rawHandle ? parseInstagramHandle(rawHandle) : null;
  const category = pick(normalized, COLUMN_ALIASES.category);
  const city = pick(normalized, COLUMN_ALIASES.city);
  const state = pick(normalized, COLUMN_ALIASES.state);
  const cityState = [city, state].filter(Boolean).join(", ");

  // Precisa de pelo menos um jeito de identificar/contatar o lead: nome,
  // telefone válido (NANP) ou Instagram. Sem nenhum dos três não dá pra
  // montar uma external_key confiável nem pra abordar o lead depois.
  if (!fullName && !phone && !handle) return null;

  const externalKey = phone
    ? `internacional:phone:${phone}`
    : handle
      ? `internacional:ig:${handle}`
      : `internacional:name:${fullName.toLowerCase()}|${city.toLowerCase()}`;

  return {
    external_key: externalKey,
    full_name: fullName || null,
    // Guarda o telefone original digitado na planilha (mais legível pra
    // conferência humana); a normalização (sanitizeInternationalPhone) só é
    // usada pra montar a external_key e o link do wa.me na hora de mandar
    // mensagem, nunca sobrescreve o dado bruto da planilha.
    phone: rawPhone || null,
    instagram: handle,
    category: category || null,
    city: cityState || null,
    status: "novo_lead",
    source: "internacional",
    notes: "Prospecção ativa EUA/Canadá, lead importado via planilha (upload) pelo dashboard.",
    raw_payload: {
      _origem: "Importado via upload de planilha CSV (Prospecção EUA/Canadá > Importar planilha).",
      csv_row: original,
    },
  };
}

/** Mesmo motivo do dedupe do TNG/Instagram: o upsert do Supabase rejeita o
 * lote inteiro se duas linhas colidirem na mesma external_key. Mantém a
 * primeira ocorrência, aproveitando campos preenchidos numa ocorrência
 * posterior se a primeira estiver vazia. */
function dedupeByExternalKey(rows: InternationalSheetLeadRow[]): {
  rows: InternationalSheetLeadRow[];
  mergedCount: number;
} {
  const seen = new Map<string, InternationalSheetLeadRow>();
  const order: string[] = [];
  let mergedCount = 0;

  for (const row of rows) {
    if (seen.has(row.external_key)) {
      mergedCount++;
      const existing = seen.get(row.external_key)!;
      existing.full_name ||= row.full_name;
      existing.phone ||= row.phone;
      existing.instagram ||= row.instagram;
      existing.category ||= row.category;
      existing.city ||= row.city;
      continue;
    }
    seen.set(row.external_key, row);
    order.push(row.external_key);
  }

  return { rows: order.map((key) => seen.get(key)!), mergedCount };
}

export function parseInternationalSheetCsv(csvText: string): ParseInternationalSheetResult {
  const firstLine = csvText.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = detectDelimiter(firstLine);
  const rawRows = parseDelimited(csvText, delimiter);

  if (rawRows.length === 0) {
    return { rows: [], totalRows: 0, skippedInvalid: 0, mergedCount: 0, identifierColumnFound: false };
  }

  const normalizedHeader = rawRows[0].map(normalizeHeader);
  const identifierColumnFound = [
    ...COLUMN_ALIASES.full_name,
    ...COLUMN_ALIASES.phone,
    ...COLUMN_ALIASES.instagram,
  ].some((alias) => normalizedHeader.includes(alias));

  const originalRecords = toRecords(rawRows);
  const normalizedRecords = toNormalizedRecords(rawRows);

  let skippedInvalid = 0;
  const built: InternationalSheetLeadRow[] = [];
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
    identifierColumnFound,
  };
}
