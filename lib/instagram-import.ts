/**
 * Parser do import em lote de leads via Instagram — usado por
 * app/api/leads/import-instagram/route.ts pra alimentar a tela "Prospecção
 * Ativa" a partir de uma lista de perfis colada pelo usuário (um por linha),
 * sem precisar cadastrar um por um pelo modal "Novo Lead".
 *
 * Formato esperado (uma linha por lead, campos depois da URL/handle são
 * opcionais e separados por ";"):
 *   https://www.instagram.com/fulano/;Fulano da Silva;Odontologia;Catanduva
 *   @fulana.consultorio;;Estética
 *   outrohandle
 *
 * Mesmo padrão de dedupe do import do TNG (lib/tng-csv.ts): agrupa por
 * external_key ("instagram:<handle>") e mantém uma linha por grupo.
 */

import { parseInstagramHandle } from "./instagram";

export interface InstagramLeadRow {
  external_key: string;
  full_name: string | null;
  instagram: string;
  category: string | null;
  city: string | null;
  status: "novo_lead";
  source: "instagram";
  notes: string;
  raw_payload: {
    _origem: string;
    linha_original: string;
  };
}

export interface ParseInstagramBulkResult {
  rows: InstagramLeadRow[];
  totalLines: number;
  skippedInvalid: number;
  mergedCount: number;
}

function buildLeadRow(line: string): InstagramLeadRow | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(";").map((p) => p.trim());
  const [rawHandle, name, category, city] = parts;

  const handle = parseInstagramHandle(rawHandle ?? "");
  if (!handle) return null;

  return {
    external_key: `instagram:${handle}`,
    full_name: name || null,
    instagram: handle,
    category: category || null,
    city: city || null,
    status: "novo_lead",
    source: "instagram",
    notes: "Prospecção ativa — perfil do Instagram importado em lote pelo dashboard.",
    raw_payload: {
      _origem: "Importado via colagem de URLs/handles (Prospecção Ativa > Importar do Instagram).",
      linha_original: trimmed,
    },
  };
}

/** Mesmo motivo do dedupe do TNG (lib/tng-csv.ts): o upsert do Supabase
 * rejeita o lote inteiro se duas linhas colidirem na mesma external_key —
 * aqui isso acontece se o usuário colar o mesmo perfil duas vezes. */
function dedupeByExternalKey(rows: InstagramLeadRow[]): {
  rows: InstagramLeadRow[];
  mergedCount: number;
} {
  const seen = new Map<string, InstagramLeadRow>();
  const order: string[] = [];
  let mergedCount = 0;

  for (const row of rows) {
    if (seen.has(row.external_key)) {
      mergedCount++;
      // Mantém a primeira ocorrência, mas aproveita nome/categoria/cidade
      // preenchidos numa ocorrência posterior se a primeira estiver vazia.
      const existing = seen.get(row.external_key)!;
      existing.full_name ||= row.full_name;
      existing.category ||= row.category;
      existing.city ||= row.city;
      continue;
    }
    seen.set(row.external_key, row);
    order.push(row.external_key);
  }

  return { rows: order.map((key) => seen.get(key)!), mergedCount };
}

export function parseInstagramBulkText(text: string): ParseInstagramBulkResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);

  let skippedInvalid = 0;
  const built: InstagramLeadRow[] = [];
  for (const line of lines) {
    const row = buildLeadRow(line);
    if (!row) {
      skippedInvalid++;
      continue;
    }
    built.push(row);
  }

  const { rows, mergedCount } = dedupeByExternalKey(built);

  return {
    rows,
    totalLines: lines.length,
    skippedInvalid,
    mergedCount,
  };
}
