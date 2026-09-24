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
 * ativa (tng_prospeccao/prospeccao) e cadastros manuais usam o canal "ativo";
 * leads de Meta Ads/Trello usam "pago" (já receberam o aviso automático de
 * recebimento). Nos dois canais, o funil de contato numerado começa na
 * análise (1º contato). */
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
      "Não faz mais parte da cadência numerada: o 1º contato oficial é a análise, logo abaixo. Use este modelo só se preferir um aquecimento mais suave antes de mandar a análise: confirma que chegou na empresa certa, cita fatores reais do perfil do lead (se a busca de concorrentes já rodou) e só oferece a análise, sem entregar ainda.",
    appliesTo: [],
    channel: "ativo",
    text: withSignature(
      `Olá, é da{{#nome}} {{nome}}{{/nome}}{{^nome}} sua empresa{{/nome}}? {{#tem_perfil}}Vi o perfil de vocês no Google{{#avaliacoes}}, com {{avaliacoes}} avaliações{{/avaliacoes}}, muito bacana o retorno que vocês já têm por lá. {{/tem_perfil}}Fiz uma pesquisa e vi que tem{{#buscas}} {{buscas}}{{/buscas}} pessoas procurando por {{#categoria}}{{categoria}}{{/categoria}}{{^categoria}}esse serviço{{/categoria}}{{#cidade}} em {{cidade}}{{/cidade}} todos os meses no Google. São possíveis pacientes que talvez não estejam te encontrando. E hoje isso vai além do Google: muita gente já pergunta direto pra ferramentas de IA, tipo ChatGPT, qual profissional procurar, e quem não está bem posicionado simplesmente não é citado nessas respostas.{{#concorrente}} Hoje quem aparece na frente {{#categoria}}pra "{{categoria}}{{#cidade}} em {{cidade}}{{/cidade}}"{{/categoria}}{{^categoria}}nessa busca{{/categoria}} é {{concorrente}}{{#avaliacoes_concorrente}} ({{avaliacoes_concorrente}}){{/avaliacoes_concorrente}}.{{/concorrente}} Preparei uma análise gratuita mostrando esses números reais e o potencial de vocês aparecerem mais nas buscas e nas IAs, e atenderem mais gente. Posso te enviar? Não tem nenhum custo.`
    ),
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
      `{{#primeiro_nome}}{{primeiro_nome}}, {{/primeiro_nome}}conseguiu dar uma olhada na análise que te mandei sobre a presença de vocês no Google e nas buscas por IA? Ela mostra como{{#categoria}} {{categoria}}{{/categoria}}{{^categoria}} vocês{{/categoria}}{{#cidade}} em {{cidade}}{{/cidade}} aparece hoje nessas buscas. Fico curioso: isso bate com o que você sente no dia a dia, tipo vem menos paciente novo do que gostaria, ou sobra mais horário vago na agenda do que deveria? Se preferir, me chama que já te reenvio a análise.`
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
      "6º contato: pergunta quanto vale pra o lead ter a agenda mais cheia e menos ociosidade (pergunta de necessidade/benefício, SPIN) antes de reforçar que é esse o resultado que os clientes que aplicam o diagnóstico costumam ter, sem soar como se fosse a última tentativa, ainda tem o 7º e o 8º.",
    appliesTo: ["quinto_contato"],
    channel: "ambos",
    text: withSignature(
      `{{#primeiro_nome}}{{primeiro_nome}}, {{/primeiro_nome}}sei que já mandei algumas mensagens por aqui, prometo que estou quase parando de insistir 😅 Deixa eu te perguntar direto: hoje, quanto valeria pra você ter a agenda mais cheia, com menos horário ocioso entre um atendimento e outro, e mais faturamento no fim do mês? É esse o resultado que os clientes que aplicam esse diagnóstico costumam ter{{#categoria}}, entre profissionais de {{categoria}}{{/categoria}}{{#cidade}} em {{cidade}}{{/cidade}}. Faz sentido a gente conversar essa semana pra eu te mostrar como chegar nisso, sem custo algum?`
    ),
  },
  {
    id: "prova_social",
    label: "7º contato: Prova social",
    description:
      "7º contato: fortalece a credibilidade citando resultado real de outro cliente que aplicou o mesmo diagnóstico, e pergunta se um resultado parecido faria diferença pro lead, sem pedir reunião de novo (evita empilhar fechamento logo depois do 6º contato).",
    appliesTo: ["sexto_contato"],
    channel: "ambos",
    text: withSignature(
      `{{#primeiro_nome}}{{primeiro_nome}}, {{/primeiro_nome}}só um exemplo rápido pra ilustrar: outros clientes nossos{{#categoria}}, também de {{categoria}}{{/categoria}}, aplicaram exatamente esse diagnóstico e em poucos meses já apareciam entre os primeiros resultados do Google{{#cidade}} em {{cidade}}{{/cidade}} e passaram a ser citados nas respostas de IA, o que se traduz direto em mais paciente novo chegando sem precisar de indicação. É esse mesmo caminho que mapeamos pra vocês na análise que te mandei. Um resultado parecido faria diferença real aí pra vocês?`
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
    id: "personalizada",
    label: "Mensagem em branco",
    description: "Sem modelo. Escreva do zero, usado como padrão fora do funil de contato (Contrato Assinado, Retornar Depois, Finalizado).",
    appliesTo: ["contrato_assinado", "retornar_depois", "finalizado"],
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
 * bloco de "sem site" quando o lead tem site) são descartados.
 */
export function renderWhatsappBlocks(
  template: WhatsappTemplate,
  vars: WhatsappTemplateVars
): { blocks: string[]; missing: string[] } {
  const source = template.blocks && template.blocks.length > 0 ? template.blocks : [template.text];
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
  };
}
