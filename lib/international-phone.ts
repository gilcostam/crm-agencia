/**
 * Normaliza um telefone dos EUA/Canadá (NANP: código de país "1" + 10
 * dígitos) pra uso em wa.me — irmão de `sanitizePhone` (lib/phone.ts), que é
 * só pra números brasileiros (força prefixo "55" e exige 12-13 dígitos no
 * total). Usar `sanitizePhone` pra esses leads quebraria de dois jeitos: ou
 * o "55" seria prepended num número que já começa com "1" (corrompendo o
 * número), ou, mesmo sem isso, o gate de tamanho (12-13 dígitos) rejeitaria
 * um NANP correto de 11 dígitos, escondendo o botão do WhatsApp em silêncio.
 *
 * Por isso este é um módulo à parte, não uma alteração em `sanitizePhone`
 * (que continua intacto pros leads brasileiros já existentes, tanto no
 * client quanto no payload do n8n). Usado só pelo canal "internacional" (ver
 * `Lead.source === "internacional"` em WhatsAppComposerModal.tsx e
 * dashboard-client.tsx).
 */
export function sanitizeInternationalPhone(phone: string | null): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  digits = digits.replace(/^0+/, "");
  if (digits.length === 10) digits = "1" + digits;
  if (digits.length !== 11 || !digits.startsWith("1")) return null;
  return digits;
}
