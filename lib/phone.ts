/** Normaliza um telefone brasileiro para comparação/uso em links (código do
 * país + DDD + número, só dígitos). Retorna null se o dado estiver
 * malformado demais para confiar no resultado.
 *
 * Usado tanto no client (link do wa.me) quanto no server (payload enviado
 * pro fluxo n8n de disparo de WhatsApp). */
export function sanitizePhone(phone: string | null): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  digits = digits.replace(/^0+/, "");
  if (!digits.startsWith("55") && (digits.length === 10 || digits.length === 11)) {
    digits = "55" + digits;
  }
  if (digits.length < 12 || digits.length > 13) return null;
  return digits;
}
