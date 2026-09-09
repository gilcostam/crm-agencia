// Helpers pra normalizar handles/URLs do Instagram e montar os links usados
// na prospecção ativa (ver app/api/leads/import-instagram/route.ts,
// app/api/leads/route.ts e app/dashboard/_components/InstagramComposerModal.tsx).
//
// Importante: o Instagram não tem um equivalente ao "wa.me/<phone>?text=..."
// do WhatsApp — o deep link de DM (ig.me/m/<handle>) abre a conversa mas não
// permite pré-preencher o texto da mensagem. Por isso o composer de
// Instagram sempre depende de um passo manual de copiar/colar feito pelo
// humano, nunca de envio automático.

const IGNORED_PATH_SEGMENTS = new Set([
  "p",
  "reel",
  "reels",
  "stories",
  "explore",
  "accounts",
  "direct",
  "tv",
]);

/**
 * Extrai o handle (sem "@", minúsculo) a partir de um handle solto
 * ("@fulano", "fulano") ou de uma URL de perfil
 * ("https://www.instagram.com/fulano/", "instagram.com/fulano?hl=pt-br").
 * Retorna null se não conseguir identificar um handle válido.
 */
export function parseInstagramHandle(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let candidate = trimmed;

  if (/instagram\.com/i.test(trimmed) || /^https?:\/\//i.test(trimmed)) {
    try {
      const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
      const url = new URL(withProtocol);
      const segments = url.pathname.split("/").filter(Boolean);
      const first = segments[0];
      if (!first || IGNORED_PATH_SEGMENTS.has(first.toLowerCase())) {
        return null;
      }
      candidate = first;
    } catch {
      return null;
    }
  }

  candidate = candidate.trim().replace(/^@/, "").split("?")[0].split("/")[0];
  candidate = candidate.toLowerCase();

  if (!candidate) return null;
  // Handles do Instagram: letras, números, ponto e underscore.
  if (!/^[a-z0-9._]{1,30}$/.test(candidate)) return null;

  return candidate;
}

/** Monta a URL canônica do perfil a partir de um handle já normalizado. */
export function instagramProfileUrl(handle: string): string {
  return `https://www.instagram.com/${handle}/`;
}

/**
 * Monta o deep link de DM do Instagram. Abre a conversa no app/site, mas
 * NÃO pré-preenche texto — diferente do wa.me do WhatsApp. O texto precisa
 * ser copiado manualmente pelo usuário e colado na conversa.
 */
export function instagramDirectUrl(handle: string): string {
  return `https://ig.me/m/${handle}`;
}

export function instagramExternalKey(handle: string): string {
  return `instagram:${handle}`;
}
