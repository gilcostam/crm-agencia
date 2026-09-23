/**
 * Parser CSV genérico, compartilhado por lib/tng-csv.ts e
 * lib/instagram-sheet-import.ts (upload de planilha na "Prospecção Ativa").
 * Suporta campos entre aspas (inclusive contendo o próprio delimitador ou
 * aspas escapadas como ""), igual ao módulo `csv` do Python, e remove um BOM
 * UTF-8 no início do texto, se existir. Extraído de lib/tng-csv.ts pra não
 * duplicar a mesma lógica quando um segundo formato de planilha precisou de
 * upload de arquivo.
 */
export function parseDelimited(text: string, delimiter: string): string[][] {
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

/** Converte linhas cruas (primeira linha = cabeçalho) em registros indexados
 * pelo texto original do cabeçalho, exatamente como veio no arquivo. */
export function toRecords(rows: string[][]): Record<string, string>[] {
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

/** Minúsculo e sem acento, pra casar cabeçalhos de planilha escritos de
 * formas diferentes ("Instagram", "instagram", "perfil do Instagram"). */
export function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Detecta se o CSV usa ";" (padrão BR/Excel-PT) ou "," (padrão Google
 * Sheets/CSV internacional) olhando a linha de cabeçalho. */
export function detectDelimiter(headerLine: string): string {
  const semicolons = (headerLine.match(/;/g) || []).length;
  const commas = (headerLine.match(/,/g) || []).length;
  return semicolons > commas ? ";" : ",";
}
