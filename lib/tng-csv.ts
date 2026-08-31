/**
 * Parser do CSV exportado pela aba "Maps" do TNG Pesquisa
 * (pesquisa.tngdigital.com.br) — usado por app/api/leads/import-tng/route.ts
 * pra deixar a importação disponível direto no dashboard (upload de arquivo),
 * sem precisar rodar scripts/import_tng_leads.py na mão.
 *
 * Esta é uma porta 1:1 da lógica em scripts/import_tng_leads.py — qualquer
 * ajuste de formato/dedupe deve ser replicado nos dois lugares (ou, melhor,
 * o script Python pode ser aposentado em favor deste caminho via UI).
 *
 * Formato esperado do CSV (delimitador ';', com BOM utf-8-sig — exatamente o
 * que o botão "baixar CSV" do TNG Pesquisa gera):
 *   posição;pontos;faixa;empresa;categoria;endereço;telefone;celular;site;
 *   situação do site;nota;avaliações;perfil verificado
 */

export interface TngLeadRow {
  external_key: string;
  full_name: string | null;
  phone: string | null;
  city: string | null;
  category: string | null;
  status: "novo_lead";
  source: "tng_prospeccao";
  notes: string;
  raw_payload: {
    _origem: string;
    csv_row: Record<string, string>;
  };
}

export interface ParseTngCsvResult {
  rows: TngLeadRow[];
  totalRows: number;
  skippedNoPhone: number;
  mergedCount: number;
}

/** Parser CSV genérico com suporte a campos entre aspas (inclusive contendo
 * o próprio delimitador ou aspas escapadas como ""), igual ao módulo `csv`
 * do Python. Também remove um BOM UTF-8 no início do texto, se existir. */
function parseDelimited(text: string, delimiter: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\r") {
      // ignora — o \n logo em seguida fecha a linha
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

function toRecords(rows: string[][]): Record<string, string>[] {
  if (rows.length === 0) return [];
  const header = rows[0];
  return rows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    header.forEach((key, i) => {
      record[key] = row[i] ?? "";
    });
    return record;
  });
}

// Endereço vem como "R. Ceará, 1048 - Centro, Catanduva - SP, 15800-003" — a
// cidade é o trecho logo antes de " - <UF>, <CEP>". Se o padrão não bater,
// simplesmente não preenche `city` — não é informação crítica pra esse tipo
// de lead.
const CITY_RE = /,\s*([^,]+?)\s*-\s*[A-Z]{2},?\s*\d{5}-?\d{3}/;

function parseCity(address: string): string | null {
  if (!address) return null;
  const m = CITY_RE.exec(address);
  return m ? m[1].trim() : null;
}

function onlyDigits(value: string | undefined | null): string {
  return (value ?? "").replace(/\D/g, "");
}

function buildLeadRow(row: Record<string, string>): TngLeadRow | null {
  const phone = (row["telefone"] || "").trim();
  const phoneDigits = onlyDigits(phone);
  if (!phoneDigits) return null;

  const score = (row["pontos"] || "").trim();
  const faixa = (row["faixa"] || "").trim();
  const siteStatus = (row["situação do site"] || "").trim();
  const rating = (row["nota"] || "").trim();
  const reviews = (row["avaliações"] || "").trim();
  const verified = (row["perfil verificado"] || "").trim().toLowerCase() === "sim";
  const address = (row["endereço"] || "").trim();

  const notesParts = [
    `Prospecção TNG — oportunidade ${score || "?"} pts (${faixa || "sem faixa"})`,
    `Site: ${siteStatus || "desconhecido"}`,
  ];
  if (rating) {
    notesParts.push(`Avaliação Google: ${rating} (${reviews || "0"} avaliações)`);
  }
  notesParts.push(`Perfil verificado no Maps: ${verified ? "sim" : "não"}`);
  if (address) {
    notesParts.push(`Endereço: ${address}`);
  }

  return {
    external_key: `tng:${phoneDigits}`,
    full_name: (row["empresa"] || "").trim() || null,
    phone: phone || null,
    city: parseCity(address),
    category: (row["categoria"] || "").trim() || null,
    status: "novo_lead",
    source: "tng_prospeccao",
    notes: notesParts.join("\n"),
    raw_payload: {
      _origem:
        "Importado via upload de CSV (Prospecção Ativa) a partir da aba Maps do TNG Pesquisa (pesquisa.tngdigital.com.br).",
      csv_row: row,
    },
  };
}

/** O upsert do Supabase (`ON CONFLICT DO UPDATE`) rejeita a request inteira
 * se duas linhas do mesmo lote tiverem a mesma `external_key` ("cannot
 * affect row a second time"). Isso acontece de verdade no CSV do TNG: várias
 * empresas da mesma busca compartilham o mesmo telefone (ex.: consultórios
 * de um mesmo prédio/clínica usando a recepção como número de contato) — não
 * é erro de digitação.
 *
 * Aqui, resolvemos agrupando por `external_key` e mantendo uma linha por
 * grupo (a de maior pontuação "pontos", como proxy de relevância), sem
 * perder as demais: os outros nomes de empresa do grupo são anexados às
 * notas do lead escolhido. Mesma lógica de scripts/import_tng_leads.py. */
function dedupeByExternalKey(rows: TngLeadRow[]): { rows: TngLeadRow[]; mergedCount: number } {
  const groups = new Map<string, TngLeadRow[]>();
  const order: string[] = [];

  for (const row of rows) {
    const key = row.external_key;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(row);
  }

  const deduped: TngLeadRow[] = [];
  let mergedCount = 0;

  for (const key of order) {
    const group = groups.get(key)!;
    if (group.length === 1) {
      deduped.push(group[0]);
      continue;
    }

    const score = (r: TngLeadRow) => {
      const raw = Number(r.raw_payload.csv_row["pontos"]);
      return Number.isFinite(raw) ? raw : 0;
    };
    group.sort((a, b) => score(b) - score(a));

    const [primary, ...others] = group;
    const otherNames = others.map((r) => r.full_name).filter((n): n is string => !!n);
    if (otherNames.length > 0) {
      primary.notes += `\nTelefone compartilhado no Maps com: ${otherNames.join("; ")}`;
    }
    deduped.push(primary);
    mergedCount += group.length - 1;
  }

  return { rows: deduped, mergedCount };
}

export function parseTngCsv(csvText: string): ParseTngCsvResult {
  const records = toRecords(parseDelimited(csvText, ";"));

  let skippedNoPhone = 0;
  const built: TngLeadRow[] = [];
  for (const record of records) {
    const leadRow = buildLeadRow(record);
    if (!leadRow) {
      skippedNoPhone++;
      continue;
    }
    built.push(leadRow);
  }

  const { rows, mergedCount } = dedupeByExternalKey(built);

  return {
    rows,
    totalRows: records.length,
    skippedNoPhone,
    mergedCount,
  };
}
