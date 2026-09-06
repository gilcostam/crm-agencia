/**
 * Cliente para a API do Serper.dev (SERP real do Google/Google Maps) usado
 * pra automatizar a busca de concorrentes de um lead: qual clínica/negócio
 * aparece na frente dele no Google quando alguém busca sua categoria na
 * cidade dele.
 *
 * Reproduz manualmente o que hoje o time preenche à mão nos campos
 * `concorrente` / `avaliacoes_concorrente` do template "diagnostico_ia" (ver
 * lib/whatsapp-templates.ts, EDITABLE_EXTRA_KEYS).
 *
 * Requer a variável de ambiente SERPER_API_KEY (conta gratuita/paga em
 * https://serper.dev — o usuário precisa criar a própria conta e gerar a
 * própria chave; nunca fabricar ou commitar uma chave aqui).
 *
 * Segue o mesmo contrato "nunca lança exceção" de lib/whatsapp-automation.ts:
 * sempre retorna { ok, error? } e loga no console em caso de falha, pra
 * nunca quebrar o fluxo que chama essa função (ex.: a API route ou o modal
 * de composição de WhatsApp).
 */

export type Competitor = {
  name: string;
  rating: number | null;
  reviewCount: number | null;
  address: string | null;
  position: number;
};

export type CompetitorSearchResult = {
  ok: true;
  competitors: Competitor[];
  /** Texto pronto pro campo `concorrente` (nome do 1º concorrente listado). */
  topCompetitorName: string | null;
  /** Texto pronto pro campo `avaliacoes_concorrente` (ex.: "4.8 (320 avaliações)"). */
  topCompetitorRatingText: string | null;
};

export type CompetitorSearchError = {
  ok: false;
  error: string;
};

/** Resultado da checagem de perfil do próprio lead no Google (Maps/Perfil da
 * Empresa). Caso comum de negócio pequeno/novo que nunca reivindicou o
 * perfil: `hasProfile: false` (isso não é um erro, é um dado de diagnóstico
 * valioso pro vendedor usar no argumento de venda). */
export type LeadProfileCheckResult =
  | {
      ok: true;
      hasProfile: boolean;
      rating: number | null;
      reviewCount: number | null;
      ratingText: string | null;
      /** Se o perfil do Google do lead lista um site. Quando não há perfil
       * encontrado (`hasProfile: false`), fica `false` por falta de sinal
       * (não necessariamente significa que o negócio não tem site nenhum,
       * só que não achamos evidência de um via o perfil do Google). */
      hasWebsite: boolean;
    }
  | CompetitorSearchError;

type SerperPlaceResult = {
  title?: string;
  rating?: number;
  ratingCount?: number;
  address?: string;
  position?: number;
  website?: string;
};

type SerperPlacesResponse = {
  places?: SerperPlaceResult[];
};

function formatRatingText(rating: number | null, reviewCount: number | null): string | null {
  if (rating === null) return null;
  const ratingText = rating.toFixed(1).replace(".", ",");
  if (reviewCount === null) return `${ratingText} estrelas`;
  return `${ratingText} estrelas (${reviewCount} avaliações)`;
}

/** Remove acentos, títulos ("dr."/"dra.") e normaliza espaços/caixa, pra
 * comparar nomes de negócio de forma tolerante (mesmo negócio quase nunca
 * aparece grafado 100% igual no Google vs. no CRM). */
function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^(dr|dra)\.?\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function namesMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  return na.includes(nb) || nb.includes(na);
}

async function fetchPlaces(query: string, apiKey: string): Promise<SerperPlaceResult[] | CompetitorSearchError> {
  try {
    const response = await fetch("https://google.serper.dev/places", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, gl: "br", hl: "pt-br" }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { ok: false, error: `Serper.dev respondeu ${response.status}: ${text || "sem corpo"}` };
    }

    const data = (await response.json()) as SerperPlacesResponse;
    return data.places ?? [];
  } catch (err) {
    const error = err instanceof Error ? err.message : "Erro desconhecido ao chamar Serper.dev";
    return { ok: false, error };
  }
}

function requireApiKey(): { apiKey: string } | CompetitorSearchError {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    const error =
      "SERPER_API_KEY não configurada no servidor. Crie uma conta em https://serper.dev, gere uma API key e adicione essa variável de ambiente.";
    return { ok: false, error };
  }
  return { apiKey };
}

/**
 * Busca, no Google Maps/Places via Serper.dev, quem aparece nas primeiras
 * posições para "<category> em <city>", excluindo o próprio negócio do lead
 * (comparação por nome, tolerante a acentos/títulos/substring) pra não
 * listar o lead como "concorrente" dele mesmo.
 */
export async function searchCompetitors(
  category: string,
  city: string,
  excludeName?: string | null
): Promise<CompetitorSearchResult | CompetitorSearchError> {
  const keyResult = requireApiKey();
  if ("error" in keyResult) {
    console.warn(`searchCompetitors: ${keyResult.error}`);
    return keyResult;
  }

  const trimmedCategory = category.trim();
  const trimmedCity = city.trim();
  if (!trimmedCategory || !trimmedCity) {
    const error = "Categoria e cidade do lead são obrigatórias pra buscar concorrentes.";
    console.warn(`searchCompetitors: ${error}`);
    return { ok: false, error };
  }

  const query = `${trimmedCategory} em ${trimmedCity}`;
  const places = await fetchPlaces(query, keyResult.apiKey);
  if (!Array.isArray(places)) {
    console.warn(`searchCompetitors: ${places.error}`);
    return places;
  }

  const filtered = places.filter((place) => {
    if (!place.title) return false;
    if (!excludeName?.trim()) return true;
    return !namesMatch(place.title, excludeName);
  });

  const competitors: Competitor[] = filtered.slice(0, 5).map((place, index) => ({
    name: place.title as string,
    rating: typeof place.rating === "number" ? place.rating : null,
    reviewCount: typeof place.ratingCount === "number" ? place.ratingCount : null,
    address: place.address ?? null,
    position: place.position ?? index + 1,
  }));

  const top = competitors[0] ?? null;

  return {
    ok: true,
    competitors,
    topCompetitorName: top?.name ?? null,
    topCompetitorRatingText: top ? formatRatingText(top.rating, top.reviewCount) : null,
  };
}

/**
 * Checa se o próprio negócio do lead tem um perfil encontrável no Google
 * (Google Maps/Perfil da Empresa), buscando por "<nome do lead> <cidade>" e
 * conferindo se algum resultado bate com o nome do lead.
 *
 * `hasProfile: false` é um resultado válido e esperado (não um erro): muito
 * negócio pequeno nunca reivindicou o próprio perfil no Google, e isso é
 * justamente o tipo de achado que vale a pena mostrar pro lead como
 * argumento de venda ("vocês nem aparecem no Google").
 */
export async function checkLeadGoogleProfile(
  fullName: string,
  city: string
): Promise<LeadProfileCheckResult> {
  const keyResult = requireApiKey();
  if ("error" in keyResult) {
    console.warn(`checkLeadGoogleProfile: ${keyResult.error}`);
    return keyResult;
  }

  const trimmedName = fullName.trim();
  const trimmedCity = city.trim();
  if (!trimmedName || !trimmedCity) {
    const error = "Nome e cidade do lead são obrigatórios pra checar o perfil no Google.";
    console.warn(`checkLeadGoogleProfile: ${error}`);
    return { ok: false, error };
  }

  const query = `${trimmedName} ${trimmedCity}`;
  const places = await fetchPlaces(query, keyResult.apiKey);
  if (!Array.isArray(places)) {
    console.warn(`checkLeadGoogleProfile: ${places.error}`);
    return places;
  }

  const match = places.find((place) => place.title && namesMatch(place.title, trimmedName));
  if (!match) {
    return { ok: true, hasProfile: false, rating: null, reviewCount: null, ratingText: null, hasWebsite: false };
  }

  const rating = typeof match.rating === "number" ? match.rating : null;
  const reviewCount = typeof match.ratingCount === "number" ? match.ratingCount : null;

  return {
    ok: true,
    hasProfile: true,
    rating,
    reviewCount,
    ratingText: formatRatingText(rating, reviewCount),
    hasWebsite: Boolean(match.website && match.website.trim()),
  };
}
