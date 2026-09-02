import { LeadStatus } from "./types";

/**
 * Modelos de mensagem de WhatsApp usados pelo composer manual (ver
 * app/dashboard/_components/WhatsAppComposerModal.tsx), acionado pelo botão
 * "Conversar no WhatsApp" no modal de detalhe do lead.
 *
 * Por quê isso existe: a mensagem fixa antiga (`whatsappUrl()` em
 * dashboard-client.tsx) era genérica e igual pra qualquer lead, em qualquer
 * estágio. Como a sequência automática de follow-up do n8n (D+1/D+3/D+7) está
 * desativada (ver lib/whatsapp-automation.ts), quem manda 2º/3º contato hoje é
 * sempre um humano clicando nesse botão — então vale a pena ter uma mensagem
 * persuasiva e already-personalizada pra cada estágio do funil, com opção de
 * editar antes de enviar (mesmo espírito da ferramenta "TNG Pesquisa" que o
 * Gil já usa pra prospecção ativa).
 *
 * Existem dois "canais" de modelo (ver `WhatsappChannel`):
 *  - "ativo": leads de prospecção ativa (fonte tng_prospeccao/prospeccao) ou
 *    cadastrados manualmente. Ninguém mandou nada pra esse lead ainda — o
 *    primeiro modelo é a abordagem inicial completa.
 *  - "pago": leads que chegam por Meta Ads ou Trello (ver
 *    ACTIVE_PROSPECTING_SOURCES/whatsappChannelForSource) e que já recebem,
 *    automaticamente, uma mensagem de boas-vindas assim que entram no CRM
 *    (ver lib/whatsapp-automation.ts:triggerWhatsappSequence, disparada pelos
 *    webhooks do Meta e do Trello). Pra esses leads o funil manual começa já
 *    no diagnóstico (2º contato), não numa "primeira abordagem" do zero.
 */

/** Placeholders aceitos nos templates abaixo. */
export interface WhatsappTemplateVars {
  /** Nome completo do lead/empresa. */
  nome?: string | null;
  /** Primeiro nome do lead (derivado de `nome`). */
  primeiro_nome?: string | null;
  cidade?: string | null;
  /** Categoria/especialidade do lead (ex.: "Cardiologista"). */
  categoria?: string | null;
  /** Nome de quem está mandando a mensagem, não vem do lead, é digitado uma
   * vez pelo vendedor e fica salvo no navegador (ver localStorage no
   * composer). Sem valor de fallback nos dados do lead, por isso é o único
   * campo "fixo" que dispara o aviso "Faltou preencher" mesmo sem estar
   * vazio no banco. */
  consultor?: string | null;
  /** Volume de buscas mensais (ex.: pesquisa feita no Ubersuggest/TNG antes de
   * abrir a conversa). Editável por mensagem (ver EDITABLE_EXTRA_KEYS). */
  buscas?: string | null;
  /** Data/hora da reunião já marcada, formatada, só relevante no template de
   * "Reunião Marcada". */
  reuniao?: string | null;
  /** Nº de avaliações do próprio lead no Google (checado na hora, igual
   * `buscas`). Usado no diagnóstico dos leads de tráfego pago. */
  avaliacoes?: string | null;
  /** Nome do concorrente líder da categoria/região, usado como comparação no
   * diagnóstico dos leads de tráfego pago. */
  concorrente?: string | null;
  /** Nº de avaliações do concorrente citado em `concorrente`. */
  avaliacoes_concorrente?: string | null;
}

type VarKey = keyof WhatsappTemplateVars;

const FIELD_LABELS: Record<VarKey, string> = {
  nome: "nome do lead",
  primeiro_nome: "nome do lead",
  cidade: "cidade",
  categoria: "categoria/especialidade",
  consultor: "seu nome",
  buscas: "volume de buscas",
  reuniao: "data da reunião",
  avaliacoes: "nº de avaliações do lead no Google",
  concorrente: "nome do concorrente",
  avaliacoes_concorrente: "nº de avaliações do concorrente",
};

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field as VarKey] ?? field;
}

/** Campos que o vendedor digita à mão pra uma mensagem específica (não vêm do
 * lead, não vêm de `consultor`/localStorage, e não são derivados
 * automaticamente como `reuniao`). O composer mostra um campo de texto pra
 * cada um desses que o modelo selecionado efetivamente usa (ver
 * `templateUsesVar`). */
export const EDITABLE_EXTRA_KEYS: VarKey[] = [
  "buscas",
  "avaliacoes",
  "concorrente",
  "avaliacoes_concorrente",
];

/** Testa se um template usa determinado placeholder (simples ou em seção),
 * pra decidir dinamicamente quais campos extras mostrar no composer. */
export function templateUsesVar(templateText: string, key: VarKey): boolean {
  return new RegExp(`\\{\\{[#^]?${key}\\}\\}`).test(templateText);
}

/** Leads que chegam por um canal que já dispara uma mensagem automática de
 * boas-vindas assim que entram no CRM (ver triggerWhatsappSequence). Espelha
 * os `trigger`s "auto_meta_ads"/"auto_trello" de lib/whatsapp-automation.ts. */
const AUTO_WELCOME_SOURCES = new Set(["meta_ads", "trello"]);

export type WhatsappChannel = "ativo" | "pago";

/** Deriva o canal de modelo a partir de `Lead.source`. Leads de prospecção
 * ativa (tng_prospeccao/prospeccao) e cadastros manuais usam o canal "ativo"
 * (abordagem do zero); leads de Meta Ads/Trello usam "pago" (já receberam a
 * mensagem de boas-vindas automática, o funil manual começa no diagnóstico). */
export function whatsappChannelForSource(source: string | null | undefined): WhatsappChannel {
  return source && AUTO_WELCOME_SOURCES.has(source) ? "pago" : "ativo";
}

export interface WhatsappTemplate {
  id: string;
  label: string;
  /** Explicação curta exibida no rodapé do composer, junto do seletor. */
  description: string;
  /** Status do lead pra que esse modelo é sugerido automaticamente ao abrir
   * o composer (ver defaultTemplateIdForStatus). */
  appliesTo: LeadStatus[];
  /** "ativo" ou "pago" restringe o modelo a leads daquele canal (ver
   * whatsappChannelForSource); "ambos" aparece nos dois. */
  channel: WhatsappChannel | "ambos";
  text: string;
}

/** Assinatura opcional ao final da mensagem, some por completo se o
 * vendedor ainda não preencheu "seu nome" (ver renderWhatsappTemplate). */
const SIGNATURE = "{{#consultor}}\n\nAbraço, {{consultor}}, da No Limits{{/consultor}}";

function withSignature(text: string): string {
  return `${text}${SIGNATURE}`;
}

export const WHATSAPP_TEMPLATES: WhatsappTemplate[] = [
  // ---- Canal "ativo": prospecção ativa / cadastro manual ----
  {
    id: "primeira_abordagem",
    label: "Primeira abordagem",
    description:
      "1º contato: confirma que chegou na empresa certa, destaca ser (ou não) citado pelas IAs, mostra a pesquisa de mercado e oferece o diagnóstico gratuito.",
    appliesTo: ["novo_lead", "primeiro_contato"],
    channel: "ativo",
    text: withSignature(
      `Olá, é da{{#nome}} {{nome}}{{/nome}}{{^nome}} sua empresa{{/nome}}? Fiz uma pesquisa e vi que tem{{#buscas}} {{buscas}}{{/buscas}} pessoas procurando por {{#categoria}}{{categoria}}{{/categoria}}{{^categoria}}esse serviço{{/categoria}}{{#cidade}} em {{cidade}}{{/cidade}} todos os meses no Google. São possíveis pacientes que talvez não estejam te encontrando. E hoje isso vai além do Google: muita gente já pergunta direto pra ferramentas de IA, tipo ChatGPT, qual profissional procurar, e quem não está bem posicionado simplesmente não é citado nessas respostas. Preparei um diagnóstico gratuito mostrando esses números reais e o potencial de vocês aparecerem mais nas buscas e nas IAs, e atenderem mais gente. Posso te enviar? Não tem nenhum custo.`
    ),
  },
  {
    id: "segundo_contato",
    label: "Segundo contato (follow-up)",
    description: "2º contato: reforça o convite pra quem ainda não respondeu, sem soar insistente.",
    appliesTo: ["segundo_contato"],
    channel: "ativo",
    text: withSignature(
      `Oi{{#primeiro_nome}}, {{primeiro_nome}}{{/primeiro_nome}}! Passando de novo por aqui 🙂 Não sei se chegou a ver minha mensagem anterior sobre o diagnóstico gratuito de {{#categoria}}{{categoria}}{{/categoria}}{{^categoria}}vocês{{/categoria}}{{#cidade}} em {{cidade}}{{/cidade}}. Ele mostra quantas pessoas pesquisam esse serviço todo mês na região e se estão te encontrando ou indo pro concorrente. Leva só 2 minutos pra olhar. Posso te enviar agora?`
    ),
  },
  {
    id: "terceiro_contato",
    label: "Terceiro contato (follow-up)",
    description: "3º e último contato da sequência: tom mais direto, sem pressão, antes de encerrar a abordagem.",
    appliesTo: ["terceiro_contato"],
    channel: "ativo",
    text: withSignature(
      `{{#primeiro_nome}}{{primeiro_nome}}, {{/primeiro_nome}}tudo bem? Essa é minha última tentativa por aqui, não quero incomodar 🙂 O diagnóstico gratuito que preparei continua disponível, mostrando o potencial de {{#categoria}}{{categoria}}{{/categoria}}{{^categoria}}vocês{{/categoria}}{{#cidade}} em {{cidade}}{{/cidade}} pra atrair mais pacientes pelo Google. Se fizer sentido, me chama que te envio agora. Se preferir não seguir por aqui, sem problema nenhum.`
    ),
  },
  {
    id: "diagnostico_enviado",
    label: "Cobrança do diagnóstico enviado",
    description: "Depois de enviar o relatório, puxa pra marcar os 15 minutos de explicação.",
    appliesTo: ["diagnostico_enviado"],
    channel: "ativo",
    text: withSignature(
      `{{#primeiro_nome}}{{primeiro_nome}}, {{/primeiro_nome}}conseguiu dar uma olhada no diagnóstico que te enviei? Ele mostra bem o cenário de {{#categoria}}{{categoria}}{{/categoria}}{{^categoria}}vocês{{/categoria}}{{#cidade}} em {{cidade}}{{/cidade}} no Google hoje e onde dá pra melhorar. Posso separar uns 15 minutos pra te explicar os números com calma e mostrar como resolveríamos isso?`
    ),
  },

  // ---- Canal "pago": Meta Ads / Trello (já recebeu boas-vindas automática) ----
  {
    id: "boas_vindas_pago",
    label: "Boas-vindas (mensagem automática)",
    description:
      "Esta mensagem já é enviada automaticamente assim que o lead chega (Meta Ads/Trello), o status só avança para 'Primeiro Contato' depois que ela sai. Use este modelo só pra reenviar manualmente, se por algum motivo ela não tiver sido entregue.",
    appliesTo: ["novo_lead"],
    channel: "pago",
    text: `Oi{{#primeiro_nome}}, {{primeiro_nome}}{{/primeiro_nome}}! Aqui é da No Limits Marketing.

Recebemos os seus dados sobre melhorar a visibilidade digital do seu negócio{{#categoria}}, {{categoria}}{{/categoria}}{{#cidade}} em {{cidade}}{{/cidade}}, e já estão com a nossa equipe.

Em breve entraremos em contato para apresentar o diagnóstico completo de visibilidade digital do seu negócio.`,
  },
  {
    id: "diagnostico_ia",
    label: "Diagnóstico (Google e IA)",
    description:
      "Primeiro contato feito por um humano, mandado logo depois da boas-vindas automática: apresenta o diagnóstico em texto, comparando o lead com o concorrente e destacando a busca por IA. Preencha as avaliações/concorrente antes de enviar.",
    appliesTo: ["primeiro_contato"],
    channel: "pago",
    text: `Nosso time fez uma análise rápida e gratuita da presença digital d{{#categoria}}o seu negócio de {{categoria}}{{/categoria}}{{^categoria}}o seu negócio{{/categoria}} no Google, comparando com os concorrentes mais bem posicionados{{#cidade}} em {{cidade}}{{/cidade}}, e também testamos como vocês aparecem quando alguém procura {{#categoria}}"{{categoria}}{{#cidade}} em {{cidade}}{{/cidade}}"{{/categoria}}{{^categoria}}esse serviço{{/categoria}}.

O resultado chamou atenção: o perfil de vocês no Google tem{{#avaliacoes}} só {{avaliacoes}} avaliações{{/avaliacoes}}{{^avaliacoes}} poucas avaliações{{/avaliacoes}}{{#concorrente}}, enquanto quem lidera a categoria ({{concorrente}}) tem{{#avaliacoes_concorrente}} {{avaliacoes_concorrente}}{{/avaliacoes_concorrente}}{{/concorrente}}. E n{{#categoria}}a busca por "{{categoria}}{{#cidade}} em {{cidade}}{{/cidade}}"{{/categoria}}{{^categoria}}essa busca{{/categoria}}, vocês nem aparecem entre os primeiros resultados, nem no Maps nem na busca tradicional.

Isso pesa tanto pra quem pesquisa no Google quanto pra quem hoje já pergunta direto pra ferramentas de IA, tipo ChatGPT, antes de escolher{{#categoria}} {{categoria}}{{/categoria}}{{^categoria}} um profissional{{/categoria}}.

Se fizer sentido pra você, tenho um horário livre essa semana pra conversarmos rapidinho sobre como reverter isso. Podemos marcar?`,
  },
  {
    id: "cobranca_diagnostico_pago",
    label: "Cobrança do diagnóstico (Google e IA)",
    description: "Follow-up pra quem já recebeu o diagnóstico em texto e ainda não respondeu, sem soar insistente.",
    appliesTo: ["segundo_contato", "terceiro_contato", "diagnostico_enviado"],
    channel: "pago",
    text: withSignature(
      `{{#primeiro_nome}}{{primeiro_nome}}, {{/primeiro_nome}}conseguiu ver a análise que te mandei sobre a presença de vocês no Google e nas buscas por IA? Ela mostra bem onde{{#categoria}} {{categoria}}{{/categoria}}{{^categoria}} vocês{{/categoria}}{{#cidade}} em {{cidade}}{{/cidade}} está perdendo pacientes pro concorrente hoje. Posso separar uns 15 minutos essa semana pra te explicar os números com calma e mostrar como resolvemos isso? Se preferir, me chama que já te reenvio a análise.`
    ),
  },

  // ---- Compartilhados entre os dois canais ----
  {
    id: "reuniao_marcada",
    label: "Confirmação de reunião",
    description: "Lembrete/confirmação pra quem já marcou a conversa do diagnóstico.",
    appliesTo: ["reuniao_marcada"],
    channel: "ambos",
    text: withSignature(
      `{{#primeiro_nome}}{{primeiro_nome}}, {{/primeiro_nome}}tudo certo pra nossa conversa{{#reuniao}} ({{reuniao}}){{/reuniao}}! Vou te mostrar o diagnóstico completo{{#categoria}} de {{categoria}}{{/categoria}}{{#cidade}} em {{cidade}}{{/cidade}} e como podemos aumentar o número de pacientes vindos do Google. Até lá!`
    ),
  },
  {
    id: "no_show_resgate",
    label: "Resgate (não compareceu)",
    description:
      "Para quem faltou à reunião marcada: sem cobrança, gera senso de perda em relação aos concorrentes e desperta curiosidade pra receber a análise de posicionamento.",
    appliesTo: ["no_show"],
    channel: "ambos",
    text: withSignature(
      `{{#primeiro_nome}}{{primeiro_nome}}, {{/primeiro_nome}}tudo bem? Não consegui falar com você no horário que tínhamos combinado, sem problema, imagino que a rotina tenha complicado.

Só não queria que isso te custasse a chance de ver o que encontramos: enquanto{{#categoria}} outros negócios de {{categoria}}{{/categoria}}{{^categoria}} os concorrentes{{/categoria}}{{#cidade}} em {{cidade}}{{/cidade}} vêm aparecendo mais no Google e sendo recomendados pelas ferramentas de IA, isso significa pacientes indo pra eles em vez de pra vocês.

Separei um resumo rápido mostrando exatamente onde vocês estão perdendo espaço hoje e o que dá pra fazer pra reverter isso ainda esse mês. Quer que eu te mande agora, ou prefere remarcar um horário rapidinho?`
    ),
  },
  {
    id: "personalizada",
    label: "Mensagem em branco",
    description: "Sem modelo. Escreva do zero, usado como padrão fora do funil de contato (Contrato Assinado, Retornar Depois, Finalizado, Desqualificado).",
    appliesTo: ["contrato_assinado", "retornar_depois", "finalizado", "desqualificado"],
    channel: "ambos",
    text: "",
  },
];

/** Modelos visíveis pra um canal específico, na ordem em que devem aparecer
 * no seletor do composer (ativos/pagos primeiro, compartilhados por último). */
export function getTemplatesForChannel(channel: WhatsappChannel): WhatsappTemplate[] {
  return WHATSAPP_TEMPLATES.filter((t) => t.channel === channel || t.channel === "ambos");
}

export function defaultTemplateIdForStatus(status: LeadStatus, channel: WhatsappChannel): string {
  const templates = getTemplatesForChannel(channel);
  const match = templates.find((t) => t.appliesTo.includes(status));
  return match ? match.id : "personalizada";
}

export function getTemplate(id: string): WhatsappTemplate {
  return WHATSAPP_TEMPLATES.find((t) => t.id === id) ?? WHATSAPP_TEMPLATES[WHATSAPP_TEMPLATES.length - 1];
}

/** Casa \{\{#campo\}\}...\{\{/campo\}\} (renderiza só se presente) e
 * \{\{^campo\}\}...\{\{/campo\}\} (renderiza só se ausente), sintaxe
 * inspirada em Mustache, minimalista de propósito (sem loops). O `do/while`
 * resolve o caso de aninhamento que os templates usam de fato: um bloco de
 * campo A dentro de um bloco de campo B (ex.: `{{#categoria}}...{{#cidade}}
 * ...{{/cidade}}...{{/categoria}}`), já que uma única passagem de regex
 * deixaria o bloco interno sem processar. */
const SECTION_RE = /\{\{([#^])(\w+)\}\}([\s\S]*?)\{\{\/\2\}\}/;

export function renderWhatsappTemplate(
  template: string,
  vars: WhatsappTemplateVars
): { text: string; missing: string[] } {
  const missing = new Set<string>();

  function present(field: VarKey): boolean {
    const value = vars[field];
    return Boolean(value && value.trim());
  }

  let text = template;
  let prev: string;
  do {
    prev = text;
    text = text.replace(SECTION_RE, (_match, kind: string, field: string, inner: string) => {
      const key = field as VarKey;
      const isPresent = present(key);
      if (!isPresent) missing.add(key);
      if (kind === "#") return isPresent ? inner : "";
      return isPresent ? "" : inner; // kind === "^"
    });
  } while (text !== prev);

  text = text.replace(/\{\{(\w+)\}\}/g, (_match, field: string) => {
    const key = field as VarKey;
    const value = vars[key];
    if (value && value.trim()) return value.trim();
    missing.add(key);
    return "";
  });

  text = text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([.,!?])/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { text, missing: Array.from(missing) };
}

export function buildTemplateVars(
  lead: { full_name: string | null; city: string | null; category: string | null },
  extras: Partial<Record<Exclude<VarKey, "nome" | "primeiro_nome" | "cidade" | "categoria">, string | null>> = {}
): WhatsappTemplateVars {
  const fullName = lead.full_name?.trim() || "";
  return {
    nome: fullName || null,
    primeiro_nome: fullName ? fullName.split(" ")[0] : null,
    cidade: lead.city?.trim() || null,
    categoria: lead.category?.trim() || null,
    consultor: extras.consultor?.trim() || null,
    buscas: extras.buscas?.trim() || null,
    reuniao: extras.reuniao?.trim() || null,
    avaliacoes: extras.avaliacoes?.trim() || null,
    concorrente: extras.concorrente?.trim() || null,
    avaliacoes_concorrente: extras.avaliacoes_concorrente?.trim() || null,
  };
}
