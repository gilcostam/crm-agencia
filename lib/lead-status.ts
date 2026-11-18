import { LeadStatus } from "./types";

/** Quantas horas de intervalo a equipe combinou dar entre um contato e o
 * próximo (1º → 2º → 3º contato), antes de decidir mover o lead pra
 * "Finalizado" manualmente caso não haja resposta. */
export const FOLLOWUP_INTERVAL_HOURS = 48;

/** Status que, ao serem alcançados, disparam o agendamento automático do
 * próximo follow-up (48h à frente) — a sequência de tentativas de contato.
 * "no_show" entra aqui também: vira um lembrete de mandar a mensagem de
 * resgate pra quem faltou à reunião.
 *
 * "diagnostico_enviado" entrou depois, e por um motivo medido: ele não
 * estava nesta lista nem na de limpar, então era um status sem relógio
 * nenhum. O lead entrava ali e ficava, porque nada agendava um retorno e
 * nada limpava o retorno velho. Dos 23 leads parados nesse status, 19
 * estavam com follow-up vencido de meses antes e a mediana de silêncio era
 * de 76 dias. Mandar o diagnóstico é o ponto mais perto da venda em todo o
 * funil, e era o único lugar onde o CRM não pedia o próximo passo. */
const AUTO_FOLLOWUP_STATUSES: LeadStatus[] = [
  "primeiro_contato",
  "segundo_contato",
  "terceiro_contato",
  "quarto_contato",
  "quinto_contato",
  "sexto_contato",
  "setimo_contato",
  "no_show",
  "diagnostico_enviado",
];

/** Status "de saída" do funil de contato — ao entrar neles não faz mais
 * sentido ter um follow-up pendente agendado, então ele é limpo.
 * "retornar_depois" entra aqui também: é uma saída do funil ativo (não
 * fechou, mas também não foi descartado), então o follow-up automático de
 * 48h não faz sentido; se a equipe já sabe quando quer retomar o contato,
 * define um novo `next_followup` manualmente na tela do lead. */
const CLEAR_FOLLOWUP_STATUSES: LeadStatus[] = [
  "finalizado",
  "desqualificado",
  "contrato_assinado",
  "retornar_depois",
];

export interface StatusChangeUpdate {
  status: LeadStatus;
  status_dates: Partial<Record<LeadStatus, string>>;
  next_followup?: string | null;
}

function normalizeStatusDates(value: unknown): Partial<Record<LeadStatus, string>> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Partial<Record<LeadStatus, string>>;
  }
  return {};
}

/** Calcula os campos derivados de uma mudança de status: registra a data
 * dessa transição em `status_dates` (preservando as anteriores) e agenda —
 * ou limpa — `next_followup` automaticamente, seguindo a política combinada
 * com a equipe (48h de intervalo entre contatos, até o terceiro; depois
 * disso o lead é movido manualmente pra "Finalizado").
 *
 * Usado tanto pelo PATCH manual (app/api/leads/[id]/route.ts) quanto pelo
 * avanço automático de status ao confirmar o primeiro envio de WhatsApp
 * (app/api/webhook/whatsapp/route.ts), pra manter os dois caminhos
 * consistentes.
 *
 * Não mexe em `next_followup` se quem chamou já informou um valor explícito
 * pra esse campo na mesma requisição (`explicitNextFollowup: true`) — a
 * escolha manual do usuário sempre tem prioridade sobre o valor sugerido.
 */
export function buildStatusChangeUpdate(
  previousStatusDates: unknown,
  newStatus: LeadStatus,
  options: { explicitNextFollowup?: boolean; sameDayFollowup?: boolean } = {}
): StatusChangeUpdate {
  const nowIso = new Date().toISOString();
  const status_dates = { ...normalizeStatusDates(previousStatusDates), [newStatus]: nowIso };

  const update: StatusChangeUpdate = { status: newStatus, status_dates };

  if (!options.explicitNextFollowup) {
    if (AUTO_FOLLOWUP_STATUSES.includes(newStatus)) {
      const followup = new Date();
      // `sameDayFollowup`: caso especial do 1º contato automático (mensagem
      // disparada assim que o lead chega via Meta Ads/Trello, ver
      // app/api/webhook/whatsapp/route.ts) — o 2º contato (humano) precisa
      // acontecer no mesmo dia, não 48h depois, já que quem "gastou" o 1º
      // contato foi o bot, não a equipe.
      const daysAhead = options.sameDayFollowup ? 0 : 2;
      followup.setUTCDate(followup.getUTCDate() + daysAhead); // 48h, em termos de data (next_followup é `date`)
      update.next_followup = followup.toISOString().slice(0, 10);
    } else if (CLEAR_FOLLOWUP_STATUSES.includes(newStatus)) {
      update.next_followup = null;
    }
  }

  return update;
}

/** Status que provam que o lead já recebeu algum contato nosso — qualquer um
 * deles em `status_dates` significa que alguém já falou com ele (ou pelo
 * menos tentou e registrou). Não inclui "novo_lead" (é só a chegada) nem
 * "finalizado"/"desqualificado"/"retornar_depois" (são saídas: entrar neles
 * não é contato).
 *
 * Existe por causa de um número medido em 17/11/2026: dos 487 leads perdidos
 * da base, 215 (44%) não tinham NENHUM destes status no histórico, ou seja,
 * foram dados como perdidos sem terem recebido uma mensagem. 201 dos 215
 * vinham do Trello — o único canal que já gerou contrato — e todos os 215
 * tinham telefone. A perda não era rejeição do lead, era desistência nossa,
 * e o CRM não dizia nada na hora de arrastar o card. */
export const CONTACT_PROOF_STATUSES: LeadStatus[] = [
  "primeiro_contato",
  "segundo_contato",
  "terceiro_contato",
  "quarto_contato",
  "quinto_contato",
  "sexto_contato",
  "setimo_contato",
  "reuniao_marcada",
  "no_show",
  "diagnostico_enviado",
  "contrato_assinado",
];

/** Status de perda: o lead sai do funil sem ter fechado. */
export const LOSS_STATUSES: LeadStatus[] = ["finalizado", "desqualificado"];

/** `true` quando o histórico do lead não tem nenhuma prova de contato.
 * Usado pra pedir confirmação antes de dar o lead como perdido, e pra montar
 * a fila do dia.
 *
 * Duas fontes de prova, e as duas são necessárias:
 *
 * 1. `status_dates` (ver CONTACT_PROOF_STATUSES), que só é escrito quando o
 *    status muda.
 * 2. `houveMensagem`, que o chamador apura na timeline (`lead_events`).
 *
 * A segunda existe porque a primeira sozinha mentia. Medido em 18/11/2026:
 * dos 487 leads perdidos, 215 não tinham prova em `status_dates`, mas 41
 * deles tinham recebido a mensagem automática inicial do Trello e 100
 * tinham nota do compositor, ou seja, alguém abriu o WhatsApp com a
 * mensagem pronta. Sem nenhum toque mesmo: 97, e não 215. Olhar só o
 * `status_dates` fazia o aviso gritar em lead já contatado, que é o jeito
 * mais rápido de ensinar a usuária a ignorar o aviso.
 *
 * Importante: "nunca contatado" aqui é sempre uma afirmação sobre o que o
 * CRM registrou, não sobre o mundo. Leads muito antigos podem ter sido
 * trabalhados por fora (o Trello era o quadro real) e chegado aqui já com o
 * estado final — por isso a travessa pede confirmação em vez de bloquear. */
export function nuncaFoiContatado(statusDates: unknown, houveMensagem = false): boolean {
  if (houveMensagem) return false;
  const sd = normalizeStatusDates(statusDates);
  return !CONTACT_PROOF_STATUSES.some((s) => sd[s]);
}
