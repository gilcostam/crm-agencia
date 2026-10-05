import { LeadStatus, meetingUrgency } from "./types";

/**
 * Modelos de mensagem de WhatsApp usados pelo composer manual (ver
 * app/dashboard/_components/WhatsAppComposerModal.tsx), acionado pelo botão
 * "Conversar no WhatsApp" no modal de detalhe do lead.
 *
 * Por quê isso existe: a mensagem fixa antiga (`whatsappUrl()` em
 * dashboard-client.tsx) era genérica e igual pra qualquer lead, em qualquer
 * estágio. Como a sequência automática de follow-up do n8n (D+1/D+3/D+7) está
 * desativada (ver lib/whatsapp-automation.ts), quem manda 2º/3º contato hoje é
 * sempre um humano clicando nesse botão, então vale a pena ter uma mensagem
 * persuasiva e already-personalizada pra cada estágio do funil, com opção de
 * editar antes de enviar (mesmo espírito da ferramenta "TNG Pesquisa" que o
 * Gil já usa pra prospecção ativa).
 *
 * Existem dois "canais" de modelo (ver `WhatsappChannel`):
 *  - "ativo": leads de prospecção ativa (fonte tng_prospeccao/prospeccao) ou
 *    cadastrados manualmente. Ninguém mandou nada pra esse lead ainda: o
 *    1º contato já é a análise (ver doc da cadência mais abaixo).
 *  - "pago": leads que chegam por Meta Ads ou Trello (ver
 *    ACTIVE_PROSPECTING_SOURCES/whatsappChannelForSource) e que já recebem,
 *    automaticamente, uma mensagem de boas-vindas assim que entram no CRM
 *    (ver lib/whatsapp-automation.ts:triggerWhatsappSequence, disparada pelos
 *    webhooks do Meta e do Trello). Essa boas-vindas é só um aviso de
 *    recebimento, não conta como um dos 8 contatos da cadência. O 1º
 *    contato de verdade, pros dois canais, é a análise (o diagnóstico
 *    completo só acontece ao vivo, na reunião).
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
  /** Bandeira "sim"/ausente (nunca é exibida como texto) pra alternar o
   * bloco de diagnóstico entre o tom positivo ("já tem perfil, falta só
   * otimizar") e o tom de alerta genérico ("achamos um ponto de atenção"),
   * sem citar o dado em si na mensagem pro lead. Preenchida automaticamente
   * pela busca de concorrentes (ver checkLeadGoogleProfile em lib/serper.ts),
   * nunca editada manualmente (por isso não entra em EDITABLE_EXTRA_KEYS). */
  tem_perfil?: string | null;
  /** Mesma lógica de `tem_perfil`, mas pra presença de site (ver
   * hasWebsite em lib/serper.ts). */
  tem_site?: string | null;
  /** Observação livre sobre o perfil de Instagram do lead (ex.: "feed bonito
   * mas bio sem link", "poucas fotos recentes"), digitada à mão pelo vendedor
   * depois de olhar o perfil (ver InstagramComposerModal.tsx). Só usada nos
   * modelos do canal "instagram", pra personalizar o 1º contato com um
   * comentário real sobre o próprio perfil, além dos dados de Google/IA. */
  nota_perfil?: string | null;
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
  tem_perfil: "se o lead tem perfil no Google",
  tem_site: "se o lead tem site",
  nota_perfil: "observação sobre o perfil do Instagram",
};

/** Vars usadas só como bandeira de presença/ausência (`tem_perfil`,
 * `tem_site`), nunca exibidas como texto. Ausência delas é um resultado
 * válido e esperado (ex.: lead realmente não tem site) e não deve disparar
 * o aviso de "faltou preencher" do composer, por isso ficam de fora do
 * cálculo de `missing` em `renderWhatsappTemplate`. */
const SILENT_FLAG_KEYS = new Set<VarKey>(["tem_perfil", "tem_site"]);

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
  "nota_perfil",
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

export type WhatsappChannel = "ativo" | "pago" | "instagram" | "internacional";

/** Idioma da abordagem, só relevante pro canal "internacional" (EUA/Canadá):
 * muitos desses leads são donos de negócio brasileiros morando lá (ex.:
 * planilha levantada em grupos de brasileiros no Facebook, ver
 * lib/international-sheet-import.ts), que preferem ser abordados em
 * português mesmo com o negócio nos EUA/Canadá. "en" é o padrão (preserva o
 * comportamento original da cadência internacional); "pt" usa `textPt` dos
 * templates abaixo quando disponível (ver `pickTemplateText`). Os demais
 * canais (ativo/pago/instagram) já são sempre em português, não usam isso. */
export type WhatsappLanguage = "en" | "pt";

/** Deriva o canal de modelo a partir de `Lead.source`. Leads de prospecção
 * ativa (tng_prospeccao/prospeccao) e cadastros manuais usam o canal "ativo";
 * leads de Meta Ads/Trello usam "pago" (já receberam o aviso automático de
 * recebimento). Nos dois canais, o funil de contato numerado começa na
 * análise (1º contato). Leads de `source: "internacional"` (EUA/Canadá, ver
 * lib/international-sheet-import.ts e app/dashboard/prospeccao/internacional)
 * usam o canal "internacional" direto, checado antes do resto: diferente do
 * canal "instagram" (escolhido à parte, pelo InstagramComposerModal, pra não
 * misturar com leads que têm telefone além do Instagram), aqui faz sentido
 * decidir dentro desta função porque o canal "internacional" já é o dono do
 * telefone/WhatsApp do lead, não uma exceção só de Instagram. Não cobre o
 * canal "instagram": esse continua escolhido à parte (ver comentário no
 * InstagramComposerModal.tsx). */
export function whatsappChannelForSource(source: string | null | undefined): WhatsappChannel {
  if (source === "internacional") return "internacional";
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
  /** Texto único (compatibilidade com o composer de textarea simples). Pra
   * modelos com `blocks`, é só a concatenação deles (usado por
   * `templateUsesVar`/detecção de campos extras, nunca exibido sozinho). */
  text: string;
  /** Quando presente, o composer mostra a mensagem dividida em blocos
   * separados (uma "bolha" por bloco, cada um com seu próprio botão de
   * copiar) em vez de um texto único gigante, pra soar como uma conversa
   * humana normal (várias mensagens curtas) em vez de um bloco de texto que
   * parece gerado por bot. Blocos que renderizam vazios (ex.: seção
   * condicional sem conteúdo) são descartados automaticamente, ver
   * `renderWhatsappBlocks`. */
  blocks?: string[];
  /** Versão em português de `text`, só usada pelo canal "internacional"
   * (ver `WhatsappLanguage`/`pickTemplateText`) — leads de donos de negócio
   * brasileiros nos EUA/Canadá que preferem ser abordados no próprio idioma.
   * Ausente em todos os templates dos demais canais (já são sempre em
   * português) e, por ora, nos modelos "ambos"/não numerados do canal
   * internacional (boas_vindas/primeira_abordagem não têm variante lá). */
  textPt?: string;
}

/** Assinatura opcional ao final da mensagem, some por completo se o
 * vendedor ainda não preencheu "seu nome" (ver renderWhatsappTemplate). */
const SIGNATURE = "{{#consultor}}\n\nAbraço, {{consultor}}, da No Limits{{/consultor}}";

function withSignature(text: string): string {
  return `${text}${SIGNATURE}`;
}

/**
 * Diagnóstico "Google e IA" dividido em blocos curtos (ver `blocks` em
 * WhatsappTemplate) em vez de um texto único, pra soar como uma sequência
 * natural de mensagens de WhatsApp em vez de um bloco de texto que parece
 * gerado por bot. Tom pensado pra nunca soar acusatório:
 *  - Se o lead tem perfil no Google (`tem_perfil`), parabeniza: já tem a
 *    base pra ranquear, falta só otimizar.
 *  - Se não tem perfil, ou não tem site (`tem_site`), sinaliza como "ponto
 *    de atenção" de forma genérica, sem revelar qual é o problema (a ideia é
 *    despertar curiosidade, não entregar o diagnóstico completo de graça
 *    por texto, isso só acontece ao vivo, na reunião).
 *  - Sempre fecha com o gancho da reunião: mostrar ao vivo, no mapa da
 *    cidade, as oportunidades que não estão sendo aproveitadas, sem precisar
 *    de anúncio pago.
 * `tem_perfil`/`tem_site` são preenchidos automaticamente pela busca de
 * concorrentes (ver handleSearchCompetitors no composer), nunca digitados à
 * mão.
 */
const DIAGNOSTICO_IA_BLOCKS: string[] = [
  `Nosso time fez uma análise rápida e gratuita da presença digital d{{#categoria}}o seu negócio de {{categoria}}{{/categoria}}{{^categoria}}o seu negócio{{/categoria}} no Google{{#cidade}} em {{cidade}}{{/cidade}}, incluindo como vocês aparecem quando alguém pergunta pra ferramentas de IA, tipo ChatGPT, antes de escolher{{#categoria}} {{categoria}}{{/categoria}}{{^categoria}} um profissional{{/categoria}}.`,
  `{{#tem_perfil}}Boa notícia: vocês já têm perfil no Google{{#avaliacoes}}, com {{avaliacoes}} avaliações{{/avaliacoes}}. Isso já é a base que precisa pra ranquear bem, falta só ajustar alguns pontos de otimização.{{/tem_perfil}}{{^tem_perfil}}Encontramos um ponto de atenção na presença de vocês no Google que vale a pena corrigir o quanto antes.{{/tem_perfil}}`,
  `{{^tem_site}}Também identificamos outro ponto de atenção fora do Google, que impacta diretamente quantas pessoas conseguem encontrar vocês hoje.{{/tem_site}}`,
  `{{#concorrente}}Hoje quem aparece na frente {{#categoria}}pra "{{categoria}}{{#cidade}} em {{cidade}}{{/cidade}}"{{/categoria}}{{^categoria}}nessa busca{{/categoria}} é {{concorrente}}{{#avaliacoes_concorrente}} ({{avaliacoes_concorrente}}){{/avaliacoes_concorrente}}. Dá pra disputar essa posição sem depender de anúncio pago.{{/concorrente}}{{^concorrente}}Já mapeamos oportunidades concretas pra vocês passarem à frente de quem hoje aparece primeiro{{#categoria}} em "{{categoria}}{{#cidade}} em {{cidade}}{{/cidade}}"{{/categoria}}, só otimizando o que já existe, sem precisar pagar anúncio.{{/concorrente}}`,
  `Separei um horário pra te mostrar tudo isso ao vivo: vou abrir o mapa d{{#cidade}}e {{cidade}}{{/cidade}}{{^cidade}}a sua região{{/cidade}} e te mostrar, na tela, todas as oportunidades que existem hoje e não estão sendo aproveitadas pra vocês aparecerem entre os primeiros no Google, sem precisar pagar anúncio. Posso te mostrar essa semana?`,
];

/**
 * Mensagem de "break off" (desqualificação educada): usada quando o time
 * decide tirar o lead da lista ativa por falta de retorno/prioridade, mas
 * sem fechar a porta. Dividida em blocos curtos, no mesmo espírito de
 * DIAGNOSTICO_IA_BLOCKS, pra soar como uma despedida natural e não um aviso
 * automático. Nunca cita concorrente específico (só "os concorrentes",
 * genérico) porque, diferente da análise, aqui não necessariamente
 * rodamos uma busca fresca antes de mandar, citar nome exigiria conferir o
 * dado na hora (ver skill abordagem-lead-formulario).
 */
const BREAK_OFF_BLOCKS: string[] = [
  `{{#primeiro_nome}}{{primeiro_nome}}, {{/primeiro_nome}}tudo bem?`,
  `Como não tivemos retorno por aqui, entendemos que ganhar mais visibilidade no Google e nas respostas que as ferramentas de IA dão (ChatGPT, Gemini e outras) não é uma prioridade{{#categoria}} pra {{categoria}}{{/categoria}}{{#cidade}} em {{cidade}}{{/cidade}} nesse momento. Sem problema, cada negócio tem o seu momento certo pra isso.`,
  `Vou tirar seu contato da nossa lista ativa de leads por aqui, pra não ficar te enchendo o WhatsApp à toa.`,
  `Só deixo um ponto de atenção: enquanto isso, os concorrentes{{#categoria}} de {{categoria}}{{/categoria}}{{#cidade}} em {{cidade}}{{/cidade}} estão ocupando esse espaço, tanto no Google quanto nas respostas que as IAs dão pra quem procura por{{#categoria}} {{categoria}}{{/categoria}}{{^categoria}} esse serviço{{/categoria}}{{#cidade}} em {{cidade}}{{/cidade}}. É um espaço que tende a ficar mais disputado com o tempo, não menos.`,
  `De qualquer forma, fico à disposição. Se em algum momento isso virar prioridade, é só me chamar que a gente retoma a conversa de onde parou.${SIGNATURE}`,
];

/**
 * Abordagem alternativa (aquecimento antes da análise oficial, ver
 * `primeira_abordagem`). Dividida em blocos, no mesmo espírito de
 * DIAGNOSTICO_IA_BLOCKS, em vez de um texto único: além de soar mais natural,
 * evita jogar tudo (volume de busca, ameaça de IA e concorrente nomeado) numa
 * única parede de texto pro primeiro contato frio com o lead. Ajustado com
 * SPIN Selling: a implicação do problema ("pacientes que talvez não estejam
 * te encontrando") vira uma pergunta pro lead responder, em vez de só ser
 * afirmada, e o fechamento continua de baixíssimo compromisso (oferecer
 * mandar a análise, não pedir reunião), apropriado pra quem ainda não teve
 * nenhum contato antes.
 */
const PRIMEIRA_ABORDAGEM_BLOCKS: string[] = [
  `Olá, é da{{#nome}} {{nome}}{{/nome}}{{^nome}} sua empresa{{/nome}}? {{#tem_perfil}}Vi o perfil de vocês no Google{{#avaliacoes}}, com {{avaliacoes}} avaliações{{/avaliacoes}}, muito bacana o retorno que vocês já têm por lá.{{/tem_perfil}}{{^tem_perfil}}Encontrei vocês numa pesquisa rápida sobre{{#categoria}} {{categoria}}{{/categoria}}{{^categoria}} esse tipo de negócio{{/categoria}}{{#cidade}} em {{cidade}}{{/cidade}}.{{/tem_perfil}}`,
  `Vi também que tem{{#buscas}} {{buscas}}{{/buscas}} pessoas procurando por {{#categoria}}{{categoria}}{{/categoria}}{{^categoria}}esse serviço{{/categoria}}{{#cidade}} em {{cidade}}{{/cidade}} todos os meses no Google, e hoje isso vai além do Google: muita gente já pergunta direto pra ferramentas de IA, tipo ChatGPT, qual profissional procurar. Você acha que parte desse pessoal pode estar indo pra outro lugar sem nem saber que vocês existem?`,
  `{{#concorrente}}Hoje, por exemplo, quem aparece na frente {{#categoria}}pra "{{categoria}}{{#cidade}} em {{cidade}}{{/cidade}}"{{/categoria}}{{^categoria}}nessa busca{{/categoria}} é {{concorrente}}{{#avaliacoes_concorrente}} ({{avaliacoes_concorrente}}){{/avaliacoes_concorrente}}. Quem não aparece bem também não é citado nas respostas que as IAs dão pra quem pergunta isso.{{/concorrente}}{{^concorrente}}Quem não está bem posicionado simplesmente não é citado nessas respostas de IA.{{/concorrente}}`,
  `Preparei uma análise gratuita mostrando esses números reais e o potencial de vocês aparecerem mais nessas buscas e atenderem mais gente. Posso te enviar? Não tem nenhum custo.${SIGNATURE}`,
];

/**
 * Cadência específica pro canal "instagram" (leads com `source: "instagram"`,
 * ver TNG_PROSPECTING_SOURCES/ACTIVE_PROSPECTING_SOURCES em lib/types.ts e
 * InstagramComposerModal.tsx). Mesma lógica de 8 contatos da cadência
 * principal (abaixo), mas reescrita do zero pra caber na etiqueta do
 * Instagram Direct: mensagens curtas, de 1 a 3 frases, sem `blocks` (uma
 * única "bolha") e sem SIGNATURE, já que o Direct já identifica quem está
 * mandando a mensagem pela própria conta (diferente do WhatsApp, que parece
 * um número anônimo até alguém se apresentar). O 1º contato cita o próprio
 * perfil de Instagram do lead (`nota_perfil`, digitado à mão pelo vendedor
 * depois de dar uma olhada no perfil) além dos dados de Google/IA, cumprindo
 * o pedido de personalização "com análise do perfil". Mesmo cuidado do resto
 * do arquivo: nunca combina categoria + "outros clientes nossos" com a
 * cidade do próprio lead (ver prova social abaixo).
 */
const INSTAGRAM_ANALISE_TEXT =
  `Oi{{#primeiro_nome}}, {{primeiro_nome}}{{/primeiro_nome}}! Aqui é da No Limits Marketing. Vi o Instagram de vocês{{#categoria}}, {{categoria}}{{/categoria}}{{#cidade}} em {{cidade}}{{/cidade}}{{#nota_perfil}} ({{nota_perfil}}){{/nota_perfil}} e resolvi checar como vocês aparecem no Google também. Fiz uma análise gratuita rapidinha, sem compromisso: posso te mandar aqui?`;

const INSTAGRAM_COBRANCA_TEXT =
  `{{#primeiro_nome}}{{primeiro_nome}}, {{/primeiro_nome}}conseguiu ver a análise que te mandei? Só uma curiosidade: hoje o Instagram de vocês traz cliente novo, ou serve mais pra manter contato com quem já conhece o trabalho?`;

const INSTAGRAM_AUTORIDADE_TEXT =
  `Reparei um detalhe: o perfil de vocês é bom, mas isso só vira cliente novo se aparecer também quando alguém pesquisa no Google. O que mudaria pra vocês virarem a primeira opção que aparece por lá também{{#cidade}} em {{cidade}}{{/cidade}}?`;

const INSTAGRAM_TICKET_MEDIO_TEXT =
  `Uma pergunta rápida: se chegasse gente nova direto pelo Google, sem depender só do alcance do Instagram, isso mudaria seu faturamento do mês?`;

const INSTAGRAM_ALERTA_CONCORRENCIA_TEXT =
  `{{#concorrente}}Hoje é {{concorrente}} quem aparece na frente no Google, mesmo tendo um Instagram parecido com o de vocês.{{/concorrente}}{{^concorrente}}Tem concorrente com Instagram parecido aparecendo na frente de vocês no Google.{{/concorrente}} Essa diferença tende a aumentar ou diminuir com o tempo, na sua opinião?`;

const INSTAGRAM_AGENDA_CHEIA_TEXT =
  `Quanto valeria pra você ter a agenda mais cheia sem depender só do alcance do Instagram? Client{{#categoria}}es de {{categoria}}{{/categoria}} que ajustam isso no Google costumam sentir rápido. Faz sentido eu te mostrar como, sem custo?`;

const INSTAGRAM_PROVA_SOCIAL_TEXT =
  `Um exemplo rápido: outro cliente nosso{{#categoria}}, também de {{categoria}}{{/categoria}}, tinha um Instagram bom mas quase não aparecia no Google. Hoje está entre os primeiros resultados. Um resultado assim faria diferença pra vocês?`;

const INSTAGRAM_FECHAMENTO_TEXT =
  `{{#primeiro_nome}}{{primeiro_nome}}, {{/primeiro_nome}}última mensagem por aqui, pra não encher seu Direct à toa 🙂 Resumindo: o Instagram de vocês está bem cuidado, mas o Google ainda tem espaço sobrando, e outros já estão ocupando esse espaço. Se quiser retomar, é só chamar.`;

const INSTAGRAM_DIAGNOSTICO_ENVIADO_TEXT =
  `{{#primeiro_nome}}{{primeiro_nome}}, {{/primeiro_nome}}deu pra ver o diagnóstico que te mandei? Posso separar uns 15 minutos pra te explicar ao vivo e mostrar como aplicar?`;

const INSTAGRAM_REUNIAO_MARCADA_TEXT =
  `Combinado{{#reuniao}} pra {{reuniao}}{{/reuniao}}! Vou te mostrar ao vivo o diagnóstico completo{{#categoria}} de {{categoria}}{{/categoria}} e como crescer no Google além do Instagram. Até lá!`;

const INSTAGRAM_LEMBRETE_REUNIAO_TEXT =
  `Lembrete rápido: nossa conversa é{{#reuniao}} {{reuniao}}{{/reuniao}}! Vou te mostrar ao vivo as oportunidades no Google pra crescerem além do Instagram, e quem comparecer garante um bônus exclusivo. Confirma presença?`;

const INSTAGRAM_CURIOSIDADE_REUNIAO_TEXT =
  `{{#primeiro_nome}}{{primeiro_nome}}, {{/primeiro_nome}}enquanto isso já fui adiantando algo aqui: achei um ponto específico{{#categoria}} d{{categoria}}{{/categoria}} no Google que pretendo te mostrar na nossa conversa{{#reuniao}} de {{reuniao}}{{/reuniao}}. Não é nada que dá pra resolver só com Instagram. Vale muito a pena reservar esse horário 👀`;

const INSTAGRAM_NO_SHOW_TEXT =
  `Não consegui falar com você no horário combinado, sem problema! Separei um resumo rápido do que encontramos: hoje{{#categoria}} outros negócios de {{categoria}}{{/categoria}}{{^categoria}} outros concorrentes{{/categoria}} vêm ganhando mais espaço no Google. Quer que eu te mande agora, ou prefere remarcar?`;

const INSTAGRAM_BREAK_OFF_TEXT =
  `{{#primeiro_nome}}{{primeiro_nome}}, {{/primeiro_nome}}como não tivemos retorno, vou tirar seu contato da nossa lista ativa por aqui, pra não encher seu Direct à toa. Fica o alerta: enquanto isso, outros negócios{{#categoria}} de {{categoria}}{{/categoria}} seguem ganhando espaço no Google. Se virar prioridade, é só chamar.`;

const INSTAGRAM_OBJECAO_SEM_INTERESSE_TEXT =
  `{{#primeiro_nome}}{{primeiro_nome}}, {{/primeiro_nome}}sem problema! Só uma curiosidade, sem compromisso: é porque já resolveram isso de outro jeito, ou só não é prioridade agora? Se for só timing, deixo a análise separada pra quando fizer sentido dar uma olhada.`;

/**
 * Cadência específica pro canal "internacional" (leads com `source:
 * "internacional"`, EUA/Canadá, ver lib/international-sheet-import.ts e
 * app/dashboard/prospeccao/internacional/page.tsx). Mesma lógica de 8
 * contatos da cadência principal, mas em inglês e reescrita bem mais curta:
 * cultura de negócios dos EUA/Canadá valoriza objetividade ("time is
 * money"), então aqui não tem `blocks` (uma única mensagem curta por
 * contato, 1 a 3 frases, igual ao canal "instagram") nem SIGNATURE ao final.
 * Em vez de assinatura no rodapé, a 1ª mensagem (INTL_ANALISE_TEXT) já se
 * apresenta ("This is {{consultor}} with No Limits Marketing"), porque,
 * diferente do Instagram Direct, um número de WhatsApp não identifica quem
 * está mandando a mensagem sozinho. Mesmos cuidados de conteúdo do resto do
 * arquivo, traduzidos pro inglês:
 *  - análise (1º contato) é sempre "quick free check"/"results", nunca
 *    "diagnosis"/"full report": o relatório completo só é mostrado ao vivo,
 *    na reunião ("diagnostico_enviado"/"reuniao_marcada" em diante).
 *  - nunca combina categoria + cidade do PRÓPRIO lead ao citar "another
 *    client of ours" (ver intl_prova_social/intl_agenda_cheia), mesmo motivo
 *    do prova_social/agenda_cheia em português: pareceria que já atendemos
 *    um concorrente direto dele, no mesmo mercado.
 *  - tem_perfil/tem_site não são usados aqui (mesma escolha do canal
 *    "instagram"): manter os textos curtos pesou mais do que ramificar o tom
 *    por esses dois campos, que só valem a pena no diagnóstico longo
 *    (DIAGNOSTICO_IA_BLOCKS) do canal "ativo"/"pago".
 */
const INTL_ANALISE_TEXT =
  `Hi{{#primeiro_nome}}, {{primeiro_nome}}{{/primeiro_nome}}!{{#consultor}} This is {{consultor}} with No Limits Marketing.{{/consultor}}{{^consultor}} This is No Limits Marketing.{{/consultor}} We work with Brazilian entrepreneurs living abroad, and we ran a quick, free check on how{{#categoria}} your {{categoria}} business{{/categoria}}{{^categoria}} your business{{/categoria}}{{#cidade}} in {{cidade}}{{/cidade}} shows up on Google, and whether AI search tools like ChatGPT even mention you. Want me to send the results? Free, takes two minutes to read.`;

const INTL_COBRANCA_TEXT =
  `{{#primeiro_nome}}{{primeiro_nome}}, {{/primeiro_nome}}did you get a chance to look at the free check I sent? Quick question: is your website and Google listing actually bringing you new customers right now, or is it mostly word of mouth?`;

const INTL_AUTORIDADE_TEXT =
  `Here's something worth thinking about: what would it take for{{#categoria}} your {{categoria}} business{{/categoria}}{{^categoria}} you{{/categoria}} to be the first name people find{{#cidade}} in {{cidade}}{{/cidade}}, on Google and in AI search, instead of just one of the options?`;

const INTL_TICKET_MEDIO_TEXT =
  `Quick one: if new customers started finding you directly through Google every week, on top of what you already get, what would that be worth to your bottom line?`;

const INTL_ALERTA_CONCORRENCIA_TEXT =
  `{{#concorrente}}Right now {{concorrente}} is showing up ahead of you online{{#avaliacoes_concorrente}} ({{avaliacoes_concorrente}}){{/avaliacoes_concorrente}}.{{/concorrente}}{{^concorrente}}A competitor with less experience than you is currently showing up ahead of you online.{{/concorrente}} Do you think that gap gets bigger or smaller the longer it's left alone?`;

const INTL_AGENDA_CHEIA_TEXT =
  `What would a fully booked calendar be worth to you this month? That's the kind of result{{#categoria}} {{categoria}} businesses{{/categoria}}{{^categoria}} businesses{{/categoria}} usually see once they fix this. Want me to show you how, no cost?`;

const INTL_PROVA_SOCIAL_TEXT =
  `Quick example: another client of ours{{#categoria}}, also in {{categoria}}{{/categoria}}, went from barely showing up on Google to ranking on the first page in a few months, and started getting mentioned by AI search tools too. Would a result like that make a real difference for you?`;

const INTL_FECHAMENTO_TEXT =
  `{{#primeiro_nome}}{{primeiro_nome}}, {{/primeiro_nome}}last message, don't want to keep filling up your phone. Bottom line: there's real room to grow on Google and AI search, and competitors are already taking that space. If it becomes a priority, just reach out, happy to pick this back up anytime.`;

const INTL_DIAGNOSTICO_ENVIADO_TEXT =
  `{{#primeiro_nome}}{{primeiro_nome}}, {{/primeiro_nome}}did you get to look at the full report I sent? I can walk you through it live in 15 minutes and show you exactly how to act on it. What's a good time this week?`;

const INTL_REUNIAO_MARCADA_TEXT =
  `We're set{{#reuniao}} for {{reuniao}}{{/reuniao}}! I'll walk you through the full report live{{#categoria}} for your {{categoria}} business{{/categoria}} and show you exactly how to grow on Google and AI search. Talk soon!`;

const INTL_LEMBRETE_REUNIAO_TEXT =
  `Quick reminder: our call is{{#reuniao}} {{reuniao}}{{/reuniao}}! I'll show you live where you're losing visibility on Google and AI search, plus a free bonus just for showing up. Can you confirm you'll be there?`;

const INTL_CURIOSIDADE_REUNIAO_TEXT =
  `{{#primeiro_nome}}{{primeiro_nome}}, {{/primeiro_nome}}quick heads-up before our call{{#reuniao}} on {{reuniao}}{{/reuniao}}: I found something specific{{#categoria}} about your {{categoria}} business{{/categoria}} online that I want to walk you through live, it's costing you customers right now without you knowing. Worth clearing your calendar for this one.`;

const INTL_NO_SHOW_TEXT =
  `Looks like we missed each other at{{#reuniao}} {{reuniao}}{{/reuniao}}{{^reuniao}} our scheduled time{{/reuniao}}, no worries. Here's the short version: {{#categoria}}other {{categoria}} businesses{{/categoria}}{{^categoria}}competitors{{/categoria}}{{#cidade}} in {{cidade}}{{/cidade}} are gaining ground on Google while this sits unresolved. Want me to send the summary now, or find a new time?`;

const INTL_BREAK_OFF_TEXT =
  `{{#primeiro_nome}}{{primeiro_nome}}, {{/primeiro_nome}}since I haven't heard back, I'll take you off our active list so I'm not filling up your phone for nothing. One heads-up: competitors{{#categoria}} in {{categoria}}{{/categoria}} keep gaining ground on Google and AI search while this sits on the back burner. If it becomes a priority, just reach out and we'll pick up right where we left off.`;

/**
 * Versões em português dos 14 textos acima (ver `WhatsappLanguage`), uma a
 * uma, pros mesmos 14 templates do canal "internacional" — pro vendedor
 * poder escolher no composer (ver WhatsAppComposerModal.tsx) quando o lead é
 * um dono de negócio brasileiro morando nos EUA/Canadá e prefere ser
 * abordado em português, mesmo o negócio sendo de lá. Mesma estrutura de
 * seções/placeholders de cada texto em inglês correspondente (pra
 * `templateUsesVar`/campos extras do composer funcionarem igual nos dois
 * idiomas), só o texto visível muda.
 */
const INTL_PT_ANALISE_TEXT =
  `Oi{{#primeiro_nome}}, {{primeiro_nome}}{{/primeiro_nome}}!{{#consultor}} Aqui é {{consultor}}, da No Limits Marketing.{{/consultor}}{{^consultor}} Aqui é da No Limits Marketing.{{/consultor}} A gente trabalha com brasileiros que empreendem fora do Brasil, e fizemos uma checagem rápida e gratuita de como{{#categoria}} o seu negócio de {{categoria}}{{/categoria}}{{^categoria}} o seu negócio{{/categoria}}{{#cidade}} em {{cidade}}{{/cidade}} aparece no Google, e se ferramentas de busca por IA, tipo o ChatGPT, chegam a te mencionar. Quer que eu te mande o resultado? É grátis, leva uns dois minutos pra ler.`;

const INTL_PT_COBRANCA_TEXT =
  `{{#primeiro_nome}}{{primeiro_nome}}, {{/primeiro_nome}}conseguiu dar uma olhada na checagem gratuita que te mandei? Uma pergunta rápida: hoje seu site e seu perfil no Google realmente trazem cliente novo, ou é mais indicação boca a boca?`;

const INTL_PT_AUTORIDADE_TEXT =
  `Uma pergunta pra pensar: o que precisaria mudar pra{{#categoria}} o seu negócio de {{categoria}}{{/categoria}}{{^categoria}} você{{/categoria}} virar a primeira opção que as pessoas encontram{{#cidade}} em {{cidade}}{{/cidade}}, no Google e nas buscas por IA, em vez de só mais uma entre várias?`;

const INTL_PT_TICKET_MEDIO_TEXT =
  `Rapidinho: se cliente novo começasse a te achar direto pelo Google toda semana, além do que você já recebe hoje, quanto isso valeria pro seu faturamento?`;

const INTL_PT_ALERTA_CONCORRENCIA_TEXT =
  `{{#concorrente}}Hoje é {{concorrente}} quem aparece na sua frente online{{#avaliacoes_concorrente}} ({{avaliacoes_concorrente}}){{/avaliacoes_concorrente}}.{{/concorrente}}{{^concorrente}}Tem um concorrente com menos experiência que você aparecendo na sua frente online hoje.{{/concorrente}} Na sua opinião, essa diferença tende a aumentar ou diminuir se continuar assim?`;

const INTL_PT_AGENDA_CHEIA_TEXT =
  `Quanto valeria pra você ter a agenda lotada esse mês? Esse é o tipo de resultado que{{#categoria}} negócios de {{categoria}}{{/categoria}}{{^categoria}} negócios{{/categoria}} costumam ter depois de resolver isso. Quer que eu te mostre como, sem custo?`;

const INTL_PT_PROVA_SOCIAL_TEXT =
  `Um exemplo rápido: outro cliente nosso{{#categoria}}, também de {{categoria}}{{/categoria}}, quase não aparecia no Google e em poucos meses passou a ranquear na primeira página, além de começar a ser citado por ferramentas de busca com IA. Um resultado assim faria diferença de verdade pra você?`;

const INTL_PT_FECHAMENTO_TEXT =
  `{{#primeiro_nome}}{{primeiro_nome}}, {{/primeiro_nome}}última mensagem, não quero ficar enchendo seu WhatsApp à toa. Resumindo: tem espaço real pra crescer no Google e nas buscas com IA, e os concorrentes já estão ocupando esse espaço. Se virar prioridade, é só chamar, retomamos na hora.`;

const INTL_PT_DIAGNOSTICO_ENVIADO_TEXT =
  `{{#primeiro_nome}}{{primeiro_nome}}, {{/primeiro_nome}}conseguiu ver o relatório completo que te mandei? Posso te explicar tudo ao vivo em 15 minutinhos e mostrar exatamente como aplicar. Qual o melhor horário essa semana?`;

const INTL_PT_REUNIAO_MARCADA_TEXT =
  `Combinado{{#reuniao}} pra {{reuniao}}{{/reuniao}}! Vou te mostrar o relatório completo ao vivo{{#categoria}} do seu negócio de {{categoria}}{{/categoria}} e exatamente como crescer no Google e nas buscas com IA. Até lá!`;

const INTL_PT_LEMBRETE_REUNIAO_TEXT =
  `Lembrete rápido: nossa conversa é{{#reuniao}} {{reuniao}}{{/reuniao}}! Vou te mostrar ao vivo onde você está perdendo visibilidade no Google e nas buscas com IA, além de um bônus gratuito só por comparecer. Confirma presença?`;

const INTL_PT_CURIOSIDADE_REUNIAO_TEXT =
  `{{#primeiro_nome}}{{primeiro_nome}}, {{/primeiro_nome}}um aviso rápido antes da nossa conversa{{#reuniao}} de {{reuniao}}{{/reuniao}}: encontrei algo bem específico{{#categoria}} sobre o seu negócio de {{categoria}}{{/categoria}} que quero te mostrar ao vivo, está te custando cliente agora mesmo sem você saber. Vale muito a pena reservar esse horário.`;

const INTL_PT_NO_SHOW_TEXT =
  `Parece que não nos encontramos{{#reuniao}} em {{reuniao}}{{/reuniao}}{{^reuniao}} no horário combinado{{/reuniao}}, sem problema. Resumindo rápido: {{#categoria}}outros negócios de {{categoria}}{{/categoria}}{{^categoria}}concorrentes{{/categoria}}{{#cidade}} em {{cidade}}{{/cidade}} estão ganhando espaço no Google enquanto isso fica parado. Quer que eu te mande o resumo agora, ou prefere remarcar?`;

const INTL_PT_BREAK_OFF_TEXT =
  `{{#primeiro_nome}}{{primeiro_nome}}, {{/primeiro_nome}}como não tive retorno, vou tirar seu contato da nossa lista ativa, pra não ficar enchendo seu WhatsApp à toa. Só um alerta: os concorrentes{{#categoria}} de {{categoria}}{{/categoria}} seguem ganhando espaço no Google e nas buscas com IA enquanto isso fica parado. Se virar prioridade, é só chamar que retomamos de onde paramos.`;

/**
 * A cadência completa tem 8 contatos, sempre nessa ordem lógica (ver
 * `appliesTo`/`defaultTemplateIdForStatus`: o texto mostrado por padrão no
 * composer, quando o lead está no status X, é a MENSAGEM SEGUINTE a mandar,
 * ou seja, "status = primeiro_contato" já significa "o 1º contato foi feito,
 * a próxima é a nº2"):
 *   1. Análise (Google e IA): o 1º contato já entrega valor de
 *      verdade, sem precisar de "sim" antes (é uma análise rápida por
 *      texto, o diagnóstico completo só acontece ao vivo, na reunião).
 *      `primeira_abordagem` e `boas_vindas_pago` NÃO fazem mais parte da
 *      cadência numerada (ver os dois logo abaixo): ficam disponíveis só
 *      como alternativa opcional/manual, mas o modelo sugerido por padrão
 *      pro lead novo, nos dois canais, é direto a análise.
 *   2. Cobrança da análise: pergunta se viu, sem pressão.
 *   3. Autoridade/referência na especialidade.
 *   4. Ticket médio + menor dependência de convênio/plano de saúde.
 *   5. Alerta de concorrência (quem está ocupando o espaço hoje).
 *   6. Agenda cheia / mais faturamento, menos ociosidade.
 *   7. Prova social: resultado real de outro cliente, como último reforço
 *      de credibilidade antes do fechamento.
 *   8. Fechamento educado, recapitula tudo (incluindo a prova social), deixa
 *      a porta aberta.
 * Esse rótulo com o número do contato aparece também no card do Kanban (ver
 * `nextMessageLabelForLead` em dashboard-client.tsx), pra equipe nunca ter
 * dúvida de qual mensagem mandar em seguida.
 *
 * Ajuste inspirado em SPIN Selling (Neil Rackham): os contatos 2 a 7 evitam
 * só declarar benefício e pedir reunião em toda mensagem (fechamento repetido
 * demais tende a gerar resistência em venda complexa). Em vez disso, boa
 * parte deles faz uma pergunta de Problema/Implicação/Necessidade-benefício
 * pra que o próprio lead verbalize a dor ou o ganho, com o pedido de reunião
 * aparecendo intercalado (não em toda mensagem seguida).
 */
export const WHATSAPP_TEMPLATES: WhatsappTemplate[] = [
  // ---- Fora da cadência numerada: alternativa opcional / aviso automático ----
  {
    id: "primeira_abordagem",
    label: "Abordagem alternativa (opcional, antes da análise)",
    description:
      "Não faz mais parte da cadência numerada: o 1º contato oficial é a análise, logo abaixo. Use este modelo só se preferir um aquecimento mais suave antes de mandar a análise: confirma que chegou na empresa certa, cita fatores reais do perfil do lead (se a busca de concorrentes já rodou) e só oferece a análise, sem entregar ainda. Ajustado com SPIN Selling: em vez de só declarar a implicação do problema (paciente pesquisando e não te encontrando), pergunta isso ao lead, e é enviado em blocos curtos (como o 1º contato oficial) em vez de um texto único. O fechamento continua de baixo compromisso (só oferece mandar a análise, não pede reunião ainda).",
    appliesTo: [],
    channel: "ativo",
    text: PRIMEIRA_ABORDAGEM_BLOCKS.join("\n\n"),
    blocks: PRIMEIRA_ABORDAGEM_BLOCKS,
  },
  {
    id: "boas_vindas_pago",
    label: "Boas-vindas automática (mensagem do sistema)",
    description:
      "Não conta como um dos 8 contatos: é só o aviso de recebimento enviado automaticamente assim que o lead chega via Meta Ads/Trello, antes de qualquer contato de vendas de verdade. Use este modelo só pra reenviar manualmente, se por algum motivo ela não tiver sido entregue.",
    appliesTo: [],
    channel: "pago",
    text: `Oi{{#primeiro_nome}}, {{primeiro_nome}}{{/primeiro_nome}}! Aqui é da No Limits Marketing.

Recebemos os seus dados sobre melhorar a visibilidade digital do seu negócio{{#categoria}}, {{categoria}}{{/categoria}}{{#cidade}} em {{cidade}}{{/cidade}}, e já estão com a nossa equipe.

Em breve entraremos em contato para apresentar o diagnóstico completo de visibilidade digital do seu negócio.`,
  },

  // ---- Contato 1 em diante: cadência numerada, compartilhada pelos dois canais ----
  {
    id: "diagnostico_ia",
    label: "1º contato: Análise (Google e IA)",
    description:
      "1º contato oficial da cadência, pros dois canais: entrega a análise de verdade já de cara, com base em buscas reais no Google e nas respostas de ferramentas de IA (ChatGPT), em vez de só oferecer e esperar resposta. Enviado como sequência de mensagens curtas (não texto único) pra soar natural. Tom se ajusta sozinho: parabeniza quem já tem perfil no Google, e só sinaliza pontos de atenção de forma genérica (sem revelar detalhes) pra despertar curiosidade sobre o diagnóstico completo, que só acontece ao vivo, na reunião. Rode a busca de concorrentes antes de enviar pra preencher os dados automaticamente.",
    appliesTo: ["novo_lead"],
    channel: "ambos",
    text: DIAGNOSTICO_IA_BLOCKS.join("\n\n"),
    blocks: DIAGNOSTICO_IA_BLOCKS,
  },
  {
    id: "cobranca_diagnostico",
    label: "2º contato: Cobrança da análise",
    description:
      "2º contato: pergunta se viu a análise (Google e IA) enviada no 1º contato, sem soar insistente. Em vez de já pedir reunião de novo (o 1º contato já fechou com um convite), faz uma pergunta de Problema (SPIN) pra puxar o lead a comentar o que sente na prática, agenda ociosa, poucos pacientes novos etc. Tom neutro de propósito (não assume 'está perdendo pacientes'), porque a análise do 1º contato pode ter sido positiva (já tem perfil, só falta otimizar) ou de alerta, dependendo do lead. Não afirma que a análise já trouxe o passo a passo de como melhorar, isso é reservado pro diagnóstico completo, mostrado ao vivo na reunião.",
    appliesTo: ["primeiro_contato"],
    channel: "ambos",
    text: withSignature(
      `{{#primeiro_nome}}{{primeiro_nome}}, {{/primeiro_nome}}conseguiu dar uma olhada na análise que te mandei sobre a presença de vocês no Google e nas buscas por IA? Ela mostra como{{#categoria}} {{categoria}}{{/categoria}}{{^categoria}} vocês{{/categoria}}{{#cidade}} em {{cidade}}{{/cidade}} aparece hoje nessas buscas. Fico curiosa: isso bate com o que você sente no dia a dia, tipo vem menos paciente novo do que gostaria, ou sobra mais horário vago na agenda do que deveria? Se preferir, me chama que já te reenvio a análise.`
    ),
  },
  {
    id: "autoridade_referencia",
    label: "3º contato: Referência na especialidade",
    description:
      "3º contato: muda o ângulo pra autoridade e, seguindo SPIN Selling, troca a afirmação de benefício por uma pergunta de valor (o que muda pra vocês virarem a referência), pra o próprio lead verbalizar o que ganharia, em vez de só ouvir a gente afirmar isso.",
    appliesTo: ["segundo_contato"],
    channel: "ambos",
    text: withSignature(
      `{{#primeiro_nome}}{{primeiro_nome}}, {{/primeiro_nome}}voltando a insistir, mas com um motivo 🙂 Reparei um detalhe na análise que te mandei: hoje, quando alguém pesquisa por{{#categoria}} {{categoria}}{{/categoria}}{{^categoria}} esse serviço{{/categoria}}{{#cidade}} em {{cidade}}{{/cidade}} no Google ou pergunta pra uma IA, o nome que aparece primeiro nem sempre é o de quem tem mais preparo, é o de quem está mais bem posicionado online. Na prática, o que muda pra {{#categoria}}{{categoria}}{{/categoria}}{{^categoria}}vocês{{/categoria}} deixar de ser só mais um nome na lista e virar o profissional que todo mundo lembra e indica{{#cidade}} em {{cidade}}{{/cidade}}?`
    ),
  },
  {
    id: "ticket_medio_convenio",
    label: "4º contato: Ticket médio e convênios",
    description:
      "4º contato: em vez de só afirmar que o ticket médio sobe, pergunta o que isso mudaria no caixa do lead (pergunta de necessidade/benefício, SPIN), e só depois conecta com o resultado que outros clientes já têm ao virar referência.",
    appliesTo: ["terceiro_contato"],
    channel: "ambos",
    text: withSignature(
      `{{#primeiro_nome}}{{primeiro_nome}}, {{/primeiro_nome}}uma pergunta que talvez ajude a pensar nisso: se vocês passassem a atrair mais paciente particular direto pela reputação online, sem depender tanto de convênio ou plano de saúde, o que isso mudaria no ticket médio e no caixa do mês? Isso conecta direto com o que te mostrei na análise{{#categoria}} de {{categoria}}{{/categoria}}{{#cidade}} em {{cidade}}{{/cidade}}: boa parte dos nossos clientes já vive esse caminho, à medida que vira referência na região. Faz sentido eu te mostrar como, na prática?`
    ),
  },
  {
    id: "alerta_concorrencia",
    label: "5º contato: Alerta de concorrência",
    description:
      "5º contato: usa o gancho de perda, concorrente menos preparado ocupando o espaço de vocês no Google/IA. Em vez de afirmar a consequência, pergunta o que o lead acha que acontece se essa diferença continuar (pergunta de Implicação, SPIN), pra ele mesmo chegar à urgência, sem pedir reunião de novo logo em seguida (o 4º contato já pediu). Preenche automaticamente se a busca de concorrentes já rodou.",
    appliesTo: ["quarto_contato"],
    channel: "ambos",
    text: withSignature(
      `{{#primeiro_nome}}{{primeiro_nome}}, {{/primeiro_nome}}vou direto ao ponto: {{#concorrente}}hoje é {{concorrente}}{{#avaliacoes_concorrente}} ({{avaliacoes_concorrente}}){{/avaliacoes_concorrente}} quem aparece{{/concorrente}}{{^concorrente}}tem concorrente com bem menos experiência aparecendo{{/concorrente}} na frente {{#categoria}}quando alguém procura {{categoria}}{{/categoria}}{{^categoria}}nessa busca{{/categoria}}{{#cidade}} em {{cidade}}{{/cidade}}, tanto no Google quanto nas respostas de ferramentas de IA. Isso já apareceu na análise que te mandei. Na prática, é paciente escolhendo um profissional com menos preparo só porque ele aparece primeiro. O que você acha que acontece com essa diferença se ela continuar assim nos próximos meses, ela tende a diminuir sozinha ou só aumentar?`
    ),
  },
  {
    id: "agenda_cheia",
    label: "6º contato: Agenda cheia",
    description:
      "6º contato: pergunta quanto vale pra o lead ter a agenda mais cheia e menos ociosidade (pergunta de necessidade/benefício, SPIN) antes de reforçar que é esse o resultado que os clientes que aplicam o diagnóstico costumam ter. Cita só a especialidade, nunca a cidade do lead junto com 'clientes que aplicam o diagnóstico': combinar nicho + cidade nessa frase soaria como se já tivéssemos outro cliente do mesmo ramo, no mesmo mercado do lead, o que gera desconfiança/concorrência em vez de prova social (mesmo cuidado do 7º contato e do break_off, que também nunca cita concorrente específico).",
    appliesTo: ["quinto_contato"],
    channel: "ambos",
    text: withSignature(
      `{{#primeiro_nome}}{{primeiro_nome}}, {{/primeiro_nome}}sei que já mandei algumas mensagens por aqui, prometo que estou quase parando de insistir 😅 Deixa eu te perguntar direto: hoje, quanto valeria pra você ter a agenda mais cheia, com menos horário ocioso entre um atendimento e outro, e mais faturamento no fim do mês? É esse o resultado que os clientes que aplicam esse diagnóstico costumam ter{{#categoria}}, entre profissionais de {{categoria}}{{/categoria}}. Faz sentido a gente conversar essa semana pra eu te mostrar como chegar nisso, sem custo algum?`
    ),
  },
  {
    id: "prova_social",
    label: "7º contato: Prova social",
    description:
      "7º contato: fortalece a credibilidade citando resultado real de outro cliente que aplicou o mesmo diagnóstico, e pergunta se um resultado parecido faria diferença pro lead, sem pedir reunião de novo (evita empilhar fechamento logo depois do 6º contato). Cita só a especialidade do outro cliente, nunca a cidade dele: combinar nicho + cidade do próprio lead nessa frase soaria como se já tivéssemos um cliente concorrente dele, no mesmo mercado, o que gera resistência/desconfiança em vez de prova social.",
    appliesTo: ["sexto_contato"],
    channel: "ambos",
    text: withSignature(
      `{{#primeiro_nome}}{{primeiro_nome}}, {{/primeiro_nome}}só um exemplo rápido pra ilustrar: outros clientes nossos{{#categoria}}, também de {{categoria}}{{/categoria}}, aplicaram exatamente esse diagnóstico e em poucos meses já apareciam entre os primeiros resultados do Google e passaram a ser citados nas respostas de IA, o que se traduz direto em mais paciente novo chegando sem precisar de indicação. É esse mesmo caminho que mapeamos pra vocês na análise que te mandei. Um resultado parecido faria diferença real aí pra vocês?`
    ),
  },
  {
    id: "oitavo_contato",
    label: "8º contato: Fechamento educado",
    description:
      "8º e último contato da sequência: recapitula tudo que já foi mostrado (análise, concorrência, referência, ticket médio, agenda, prova social) e dá uma saída elegante, deixando a porta aberta caso o lead volte a ser prioridade.",
    appliesTo: ["setimo_contato"],
    channel: "ambos",
    text: withSignature(
      `{{#primeiro_nome}}{{primeiro_nome}}, {{/primeiro_nome}}essa realmente é a minha última mensagem por aqui, não quero encher seu WhatsApp à toa 🙂 Deixo resumido o que te mostrei nesse tempo: a análise de presença{{#categoria}} de {{categoria}}{{/categoria}}{{#cidade}} em {{cidade}}{{/cidade}} no Google e nas IAs, o espaço que hoje está sendo ocupado por outros profissionais, os resultados reais que outros clientes já tiveram com esse caminho, e como vocês também podem virar referência na região, aumentando o ticket médio e a agenda. Se em algum momento isso virar prioridade, é só me chamar que retomamos de onde paramos. Fico na torcida pelo sucesso de vocês de qualquer forma!`
    ),
  },
  {
    id: "diagnostico_enviado",
    label: "Cobrança do diagnóstico enviado (PDF)",
    description: "Depois de enviar o relatório em PDF (fluxo à parte da cadência de 8 contatos), puxa pra marcar os 15 minutos de explicação.",
    appliesTo: ["diagnostico_enviado"],
    channel: "ativo",
    text: withSignature(
      `{{#primeiro_nome}}{{primeiro_nome}}, {{/primeiro_nome}}conseguiu dar uma olhada no diagnóstico que te enviei? Ele mostra bem o cenário de {{#categoria}}{{categoria}}{{/categoria}}{{^categoria}}vocês{{/categoria}}{{#cidade}} em {{cidade}}{{/cidade}} no Google hoje e onde dá pra melhorar. Posso separar uns 15 minutos pra te explicar os números com calma e mostrar como resolveríamos isso?`
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
    id: "curiosidade_reuniao",
    label: "Aquece antes da reunião (curiosidade)",
    description:
      "Pra mandar no meio do caminho entre marcar e a data da reunião (nem confirmação recente, nem lembrete de véspera): aguça a curiosidade sobre um achado específico, sem entregar o diagnóstico, pra manter o lead 'quente' até lá.",
    appliesTo: ["reuniao_marcada"],
    channel: "ambos",
    text: withSignature(
      `{{#primeiro_nome}}{{primeiro_nome}}, {{/primeiro_nome}}enquanto isso vou adiantando algo aqui: encontrei um ponto bem específico{{#categoria}} d{{categoria}}{{/categoria}}{{#cidade}} em {{cidade}}{{/cidade}} no Google que pretendo te mostrar direitinho na nossa conversa{{#reuniao}} de {{reuniao}}{{/reuniao}} — algo que pode estar custando pacientes pra vocês sem que percebam. Vale muito a pena reservar esse horário, prometo que não vai ser "só mais uma reunião". Nos falamos lá!`
    ),
  },
  {
    id: "lembrete_reuniao",
    label: "Lembrete de reunião (com bônus)",
    description:
      "Lembrete pra mandar perto da data marcada (véspera ou no dia), reforçando o horário e usando o gancho de um bônus exclusivo, só pra quem comparecer, pra reduzir no-show.",
    appliesTo: ["reuniao_marcada"],
    channel: "ambos",
    text: withSignature(
      `{{#primeiro_nome}}{{primeiro_nome}}, {{/primeiro_nome}}passando pra lembrar da nossa conversa{{#reuniao}} marcada pra {{reuniao}}{{/reuniao}}! Vou te mostrar ao vivo o diagnóstico completo{{#categoria}} d{{categoria}}{{/categoria}}{{#cidade}} em {{cidade}}{{/cidade}} e as oportunidades reais pra atrair mais pacientes pelo Google e pelas buscas por IA.

Um adianto: só quem comparece à reunião garante, sem custo, um bônus exclusivo pra aumentar ainda mais a visibilidade do negócio. É uma condição especial só pra esse encontro, não fica disponível depois.

Confirma presença{{#reuniao}} pra {{reuniao}}{{/reuniao}}?`
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
    id: "break_off",
    label: "Break off (desqualificação educada)",
    description:
      "Para quando o time decide tirar o lead da lista ativa por falta de retorno/prioridade, sem fechar a porta: avisa que ele será removido da lista, mas deixa um ponto de atenção sobre concorrentes ocupando espaço no Google e nas IAs enquanto isso.",
    appliesTo: ["desqualificado"],
    channel: "ambos",
    text: BREAK_OFF_BLOCKS.join("\n\n"),
    blocks: BREAK_OFF_BLOCKS,
  },
  {
    id: "objecao_sem_interesse",
    label: "Objeção: 'não tenho interesse'",
    description:
      "Pra quando o lead responde direto que não tem interesse, em qualquer ponto da cadência. Em vez de argumentar contra a objeção ou insistir na reunião, faz uma pergunta aberta (SPIN, Problema) pra entender se é falta de prioridade/timing ou se já resolveram de outro jeito, e oferece uma saída de baixíssimo compromisso (deixar a análise pronta pra quando fizer sentido) em vez de forçar resposta agora. Selecione manualmente sempre que a objeção aparecer, independente do status atual do lead. Restrito ao canal \"ativo\" (prospecção ativa/cadastro manual) por pedido: não aparece nos leads de tráfego pago (Meta Ads/Trello).",
    appliesTo: [],
    channel: "ativo",
    text: withSignature(
      `{{#primeiro_nome}}{{primeiro_nome}}, {{/primeiro_nome}}sem problema, entendo perfeitamente. Só uma pergunta rápida, sem compromisso nenhum: esse "não tenho interesse" é porque já resolveram isso de outro jeito, ou é porque agora não é prioridade pra vocês? Pergunto porque, se for só uma questão de momento, posso deixar a análise gratuita{{#categoria}} d{{categoria}}{{/categoria}}{{#cidade}} em {{cidade}}{{/cidade}} separada, pronta pra quando fizer sentido revisitar o assunto, sem ficar te enchendo enquanto isso.`
    ),
  },
  {
    id: "personalizada",
    label: "Mensagem em branco",
    description: "Sem modelo. Escreva do zero, usado como padrão fora do funil de contato (Contrato Assinado, Retornar Depois, Finalizado).",
    appliesTo: ["contrato_assinado", "retornar_depois", "finalizado"],
    channel: "ambos",
    text: "",
  },

  // ---- Canal "instagram": cadência curta, própria do Instagram Direct ----
  {
    id: "instagram_analise",
    label: "1º contato: Análise (perfil + Google/IA)",
    description:
      "1º contato oficial pro Instagram: cita o próprio perfil do lead (preencha 'observação sobre o perfil' depois de dar uma olhada nele) além da análise de Google/IA, e oferece mandar a análise, sem entregar nada ainda. Curto, de propósito, pra caber na etiqueta do Direct.",
    appliesTo: ["novo_lead"],
    channel: "instagram",
    text: INSTAGRAM_ANALISE_TEXT,
  },
  {
    id: "instagram_cobranca_analise",
    label: "2º contato: Cobrança da análise",
    description: "2º contato: pergunta se viu a análise, com uma pergunta de Problema (SPIN) sobre o próprio Instagram, sem soar insistente.",
    appliesTo: ["primeiro_contato"],
    channel: "instagram",
    text: INSTAGRAM_COBRANCA_TEXT,
  },
  {
    id: "instagram_autoridade",
    label: "3º contato: Referência na especialidade",
    description: "3º contato: pergunta de valor (SPIN) sobre virar referência também no Google, não só no Instagram.",
    appliesTo: ["segundo_contato"],
    channel: "instagram",
    text: INSTAGRAM_AUTORIDADE_TEXT,
  },
  {
    id: "instagram_ticket_medio",
    label: "4º contato: Ticket médio",
    description: "4º contato: pergunta de necessidade/benefício (SPIN) sobre faturamento vindo de fora do alcance do Instagram.",
    appliesTo: ["terceiro_contato"],
    channel: "instagram",
    text: INSTAGRAM_TICKET_MEDIO_TEXT,
  },
  {
    id: "instagram_alerta_concorrencia",
    label: "5º contato: Alerta de concorrência",
    description: "5º contato: concorrente com Instagram parecido, mas melhor posicionado no Google. Pergunta de Implicação (SPIN). Preenche automaticamente se a busca de concorrentes já rodou.",
    appliesTo: ["quarto_contato"],
    channel: "instagram",
    text: INSTAGRAM_ALERTA_CONCORRENCIA_TEXT,
  },
  {
    id: "instagram_agenda_cheia",
    label: "6º contato: Agenda cheia",
    description: "6º contato: pergunta de necessidade/benefício (SPIN) sobre agenda cheia. Cita só a especialidade, nunca a cidade do lead junto de 'clientes que ajustam isso', pelo mesmo motivo do 7º contato abaixo.",
    appliesTo: ["quinto_contato"],
    channel: "instagram",
    text: INSTAGRAM_AGENDA_CHEIA_TEXT,
  },
  {
    id: "instagram_prova_social",
    label: "7º contato: Prova social",
    description: "7º contato: resultado real de outro cliente. Cita só a especialidade do outro cliente, nunca a cidade dele, pra não soar como se já atendêssemos um concorrente direto do próprio lead.",
    appliesTo: ["sexto_contato"],
    channel: "instagram",
    text: INSTAGRAM_PROVA_SOCIAL_TEXT,
  },
  {
    id: "instagram_fechamento",
    label: "8º contato: Fechamento educado",
    description: "8º e último contato: recapitula rápido e deixa a porta aberta, sem encher o Direct do lead.",
    appliesTo: ["setimo_contato"],
    channel: "instagram",
    text: INSTAGRAM_FECHAMENTO_TEXT,
  },
  {
    id: "instagram_diagnostico_enviado",
    label: "Cobrança do diagnóstico enviado (PDF)",
    description: "Depois de enviar o relatório em PDF, puxa pra marcar os 15 minutos de explicação.",
    appliesTo: ["diagnostico_enviado"],
    channel: "instagram",
    text: INSTAGRAM_DIAGNOSTICO_ENVIADO_TEXT,
  },
  {
    id: "instagram_reuniao_marcada",
    label: "Confirmação de reunião",
    description: "Lembrete/confirmação curto pra quem já marcou a conversa do diagnóstico.",
    appliesTo: ["reuniao_marcada"],
    channel: "instagram",
    text: INSTAGRAM_REUNIAO_MARCADA_TEXT,
  },
  {
    id: "instagram_curiosidade_reuniao",
    label: "Aquece antes da reunião (curiosidade)",
    description:
      "Pra mandar no meio do caminho entre marcar e a data da reunião: aguça a curiosidade sobre um achado específico, sem entregar o diagnóstico, versão curta pro Direct.",
    appliesTo: ["reuniao_marcada"],
    channel: "instagram",
    text: INSTAGRAM_CURIOSIDADE_REUNIAO_TEXT,
  },
  {
    id: "instagram_lembrete_reuniao",
    label: "Lembrete de reunião (com bônus)",
    description: "Lembrete pra mandar perto da data marcada, com o gancho do bônus exclusivo pra quem comparecer, em versão curta.",
    appliesTo: ["reuniao_marcada"],
    channel: "instagram",
    text: INSTAGRAM_LEMBRETE_REUNIAO_TEXT,
  },
  {
    id: "instagram_no_show",
    label: "Resgate (não compareceu)",
    description: "Para quem faltou à reunião: sem cobrança, gera senso de perda em relação aos concorrentes.",
    appliesTo: ["no_show"],
    channel: "instagram",
    text: INSTAGRAM_NO_SHOW_TEXT,
  },
  {
    id: "instagram_break_off",
    label: "Break off (desqualificação educada)",
    description: "Para quando o time decide tirar o lead da lista ativa por falta de retorno/prioridade, sem fechar a porta.",
    appliesTo: ["desqualificado"],
    channel: "instagram",
    text: INSTAGRAM_BREAK_OFF_TEXT,
  },
  {
    id: "instagram_objecao_sem_interesse",
    label: "Objeção: 'não tenho interesse'",
    description:
      "Pra quando o lead responde direto que não tem interesse, em qualquer ponto da cadência. Versão curta pro Direct, mesma lógica da versão em português (pergunta aberta pra entender o motivo, sem insistir na reunião). Selecione manualmente sempre que a objeção aparecer.",
    appliesTo: [],
    channel: "instagram",
    text: INSTAGRAM_OBJECAO_SEM_INTERESSE_TEXT,
  },

  // ---- Canal "internacional": cadência curta em inglês, EUA/Canadá (WhatsApp/Facebook/Instagram) ----
  {
    id: "intl_analise",
    label: "1st contact: Quick free check (Google/AI)",
    description:
      "1º contato oficial pro canal internacional: já se apresenta (número de WhatsApp não identifica sozinho quem manda, diferente do Instagram Direct) e oferece a checagem gratuita de Google/IA, sem entregar nada ainda. Curto de propósito (cultura 'time is money').",
    appliesTo: ["novo_lead"],
    channel: "internacional",
    text: INTL_ANALISE_TEXT,
    textPt: INTL_PT_ANALISE_TEXT,
  },
  {
    id: "intl_cobranca",
    label: "2nd contact: Following up",
    description: "2º contato: pergunta se viu a checagem gratuita, com uma pergunta de Problema (SPIN), sem soar insistente.",
    appliesTo: ["primeiro_contato"],
    channel: "internacional",
    text: INTL_COBRANCA_TEXT,
    textPt: INTL_PT_COBRANCA_TEXT,
  },
  {
    id: "intl_autoridade",
    label: "3rd contact: Becoming the top result",
    description: "3º contato: pergunta de valor (SPIN) sobre virar a primeira opção também no Google/IA.",
    appliesTo: ["segundo_contato"],
    channel: "internacional",
    text: INTL_AUTORIDADE_TEXT,
    textPt: INTL_PT_AUTORIDADE_TEXT,
  },
  {
    id: "intl_ticket_medio",
    label: "4th contact: Revenue impact",
    description: "4º contato: pergunta de necessidade/benefício (SPIN) sobre faturamento vindo de clientes achados no Google.",
    appliesTo: ["terceiro_contato"],
    channel: "internacional",
    text: INTL_TICKET_MEDIO_TEXT,
    textPt: INTL_PT_TICKET_MEDIO_TEXT,
  },
  {
    id: "intl_alerta_concorrencia",
    label: "5th contact: Competitor alert",
    description: "5º contato: concorrente ocupando espaço no Google/IA. Pergunta de Implicação (SPIN). Preenche automaticamente se a busca de concorrentes já rodou.",
    appliesTo: ["quarto_contato"],
    channel: "internacional",
    text: INTL_ALERTA_CONCORRENCIA_TEXT,
    textPt: INTL_PT_ALERTA_CONCORRENCIA_TEXT,
  },
  {
    id: "intl_agenda_cheia",
    label: "6th contact: Fully booked calendar",
    description: "6º contato: pergunta de necessidade/benefício (SPIN) sobre agenda cheia. Cita só a categoria, nunca a cidade do lead junto de 'businesses that fix this', mesmo motivo do 7º contato abaixo.",
    appliesTo: ["quinto_contato"],
    channel: "internacional",
    text: INTL_AGENDA_CHEIA_TEXT,
    textPt: INTL_PT_AGENDA_CHEIA_TEXT,
  },
  {
    id: "intl_prova_social",
    label: "7th contact: Social proof",
    description: "7º contato: resultado real de outro cliente. Cita só a categoria do outro cliente, nunca a cidade dele, pra não soar como se já atendêssemos um concorrente direto do próprio lead.",
    appliesTo: ["sexto_contato"],
    channel: "internacional",
    text: INTL_PROVA_SOCIAL_TEXT,
    textPt: INTL_PT_PROVA_SOCIAL_TEXT,
  },
  {
    id: "intl_fechamento",
    label: "8th contact: Polite close",
    description: "8º e último contato: recapitula rápido e deixa a porta aberta, sem encher o WhatsApp do lead.",
    appliesTo: ["setimo_contato"],
    channel: "internacional",
    text: INTL_FECHAMENTO_TEXT,
    textPt: INTL_PT_FECHAMENTO_TEXT,
  },
  {
    id: "intl_diagnostico_enviado",
    label: "Follow-up after full report sent (PDF)",
    description: "Depois de enviar o relatório em PDF, puxa pra marcar os 15 minutos de explicação.",
    appliesTo: ["diagnostico_enviado"],
    channel: "internacional",
    text: INTL_DIAGNOSTICO_ENVIADO_TEXT,
    textPt: INTL_PT_DIAGNOSTICO_ENVIADO_TEXT,
  },
  {
    id: "intl_reuniao_marcada",
    label: "Meeting confirmation",
    description: "Confirmação curta pra quem já marcou a conversa do diagnóstico.",
    appliesTo: ["reuniao_marcada"],
    channel: "internacional",
    text: INTL_REUNIAO_MARCADA_TEXT,
    textPt: INTL_PT_REUNIAO_MARCADA_TEXT,
  },
  {
    id: "intl_curiosidade_reuniao",
    label: "Warm-up before the call (curiosity)",
    description:
      "To send in the gap between booking and the meeting date: teases a specific finding without giving away the diagnosis, keeps the lead engaged until the call.",
    appliesTo: ["reuniao_marcada"],
    channel: "internacional",
    text: INTL_CURIOSIDADE_REUNIAO_TEXT,
    textPt: INTL_PT_CURIOSIDADE_REUNIAO_TEXT,
  },
  {
    id: "intl_lembrete_reuniao",
    label: "Meeting reminder (with bonus)",
    description: "Lembrete pra mandar perto da data marcada, com o gancho do bônus exclusivo pra quem comparecer, em versão curta.",
    appliesTo: ["reuniao_marcada"],
    channel: "internacional",
    text: INTL_LEMBRETE_REUNIAO_TEXT,
    textPt: INTL_PT_LEMBRETE_REUNIAO_TEXT,
  },
  {
    id: "intl_no_show",
    label: "No-show rescue",
    description: "Para quem faltou à reunião: sem cobrança, gera senso de perda em relação aos concorrentes.",
    appliesTo: ["no_show"],
    channel: "internacional",
    text: INTL_NO_SHOW_TEXT,
    textPt: INTL_PT_NO_SHOW_TEXT,
  },
  {
    id: "intl_break_off",
    label: "Break off (polite disqualification)",
    description: "Para quando o time decide tirar o lead da lista ativa por falta de retorno/prioridade, sem fechar a porta.",
    appliesTo: ["desqualificado"],
    channel: "internacional",
    text: INTL_BREAK_OFF_TEXT,
    textPt: INTL_PT_BREAK_OFF_TEXT,
  },
];

/** Modelos visíveis pra um canal específico, na ordem em que devem aparecer
 * no seletor do composer (ativos/pagos primeiro, compartilhados por último).
 * Os canais "instagram" e "internacional" são tratados à parte, sem herdar
 * os modelos "ambos" (esses são os textos longos de WhatsApp em português):
 * cada um tem sua própria cadência curta, dedicada, e sempre inclui
 * "personalizada" (mensagem em branco), único modelo "ambos" que continua
 * fazendo sentido pra qualquer canal. */
export function getTemplatesForChannel(channel: WhatsappChannel): WhatsappTemplate[] {
  if (channel === "instagram" || channel === "internacional") {
    // "personalizada" está definida antes dessas seções no array (é
    // compartilhada com os outros canais), então isolar e reanexar ao final
    // evita que "Mensagem em branco" apareça como 1ª opção no seletor.
    const channelTemplates = WHATSAPP_TEMPLATES.filter((t) => t.channel === channel);
    const blank = WHATSAPP_TEMPLATES.find((t) => t.id === "personalizada");
    return blank ? [...channelTemplates, blank] : channelTemplates;
  }
  return WHATSAPP_TEMPLATES.filter((t) => t.channel === channel || t.channel === "ambos");
}

/** Escolhe o modelo padrão a sugerir no composer pro status atual do lead.
 * Pra "reuniao_marcada" existem 3 estágios cadastrados nessa ordem, pra cada
 * canal (ver WHATSAPP_TEMPLATES acima: confirmação, aquecimento de
 * curiosidade, lembrete anti-no-show) — `meetingDatetime` (opcional,
 * retrocompatível: sem ele, sempre cai no 1º = confirmação, igual ao
 * comportamento antigo) deixa a escolha automática seguir a proximidade real
 * da reunião (ver meetingUrgency em lib/types.ts), pra não deixar o lead
 * esfriar entre marcar e comparecer: "distante" ainda é só confirmação,
 * "proxima" vira o aquecimento de curiosidade, e "iminente"/"atrasada" já
 * pedem o lembrete com bônus (o mais eficaz contra no-show). */
export function defaultTemplateIdForStatus(
  status: LeadStatus,
  channel: WhatsappChannel,
  meetingDatetime?: string | null
): string {
  const templates = getTemplatesForChannel(channel);
  const matches = templates.filter((t) => t.appliesTo.includes(status));
  if (matches.length === 0) return "personalizada";
  if (status === "reuniao_marcada" && matches.length > 1) {
    const urgency = meetingUrgency(meetingDatetime ?? null);
    if (urgency === "proxima") return matches[1].id;
    if (urgency === "iminente" || urgency === "atrasada") return matches[matches.length - 1].id;
  }
  return matches[0].id;
}

export function getTemplate(id: string): WhatsappTemplate {
  return WHATSAPP_TEMPLATES.find((t) => t.id === id) ?? WHATSAPP_TEMPLATES[WHATSAPP_TEMPLATES.length - 1];
}

/** Escolhe qual texto de um template usar conforme o idioma (ver
 * `WhatsappLanguage`): "pt" usa `textPt` quando o template tem essa
 * variante (hoje só os 14 modelos numerados do canal "internacional");
 * qualquer outro caso (idioma "en", ou template sem `textPt`, ou sem
 * `language` informado) cai no `text` normal, preservando o comportamento
 * de sempre pros outros canais (sempre em português) e pro próprio canal
 * internacional antes dessa opção existir. */
export function pickTemplateText(template: WhatsappTemplate, language: WhatsappLanguage = "en"): string {
  return language === "pt" && template.textPt ? template.textPt : template.text;
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
      if (!isPresent && !SILENT_FLAG_KEYS.has(key)) missing.add(key);
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

/**
 * Renderiza um `WhatsappTemplate` como uma lista de blocos de mensagem
 * (ver `blocks` em WhatsappTemplate). Pra modelos sem `blocks` definidos,
 * devolve uma lista de um único bloco (idêntico ao comportamento antigo de
 * `renderWhatsappTemplate(template.text, vars)`), então o composer pode usar
 * sempre esta função e só mudar a interface quando `blocks.length > 1`.
 * Blocos que renderizam vazios (ex.: seção condicional sem conteúdo, como o
 * bloco de "sem site" quando o lead tem site) são descartados. `language`
 * (ver `WhatsappLanguage`) só afeta o texto único (sem `blocks`) via
 * `pickTemplateText`: nenhum template com `blocks` tem variante `textPt`
 * hoje (só os modelos numerados do canal internacional, que não usam
 * blocks), mas o parâmetro já cobre esse caso se vier a existir.
 */
export function renderWhatsappBlocks(
  template: WhatsappTemplate,
  vars: WhatsappTemplateVars,
  language: WhatsappLanguage = "en"
): { blocks: string[]; missing: string[] } {
  const source =
    template.blocks && template.blocks.length > 0 ? template.blocks : [pickTemplateText(template, language)];
  const missing = new Set<string>();
  const blocks: string[] = [];
  for (const blockText of source) {
    const rendered = renderWhatsappTemplate(blockText, vars);
    rendered.missing.forEach((m) => missing.add(m));
    if (rendered.text.trim()) blocks.push(rendered.text.trim());
  }
  return { blocks, missing: Array.from(missing) };
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
    tem_perfil: extras.tem_perfil?.trim() || null,
    tem_site: extras.tem_site?.trim() || null,
    nota_perfil: extras.nota_perfil?.trim() || null,
  };
}
