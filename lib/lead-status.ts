import { LeadStatus } from "./types";

/** Quantas horas de intervalo a equipe combinou dar entre um contato e o
 * próximo (1º → 2º → 3º contato), antes de decidir mover o lead pra
 * "Finalizado" manualmente caso não haja resposta. */
export const FOLLOWUP_INTERVAL_HOURS = 48;

/** Status que, ao serem alcançados, disparam o agendamento automático do
 * próximo follow-up (48h à frente) — a sequência de tentativas de contato.
 * "no_show" entra aqui também: vira um lembrete de mandar a mensagem de
 * resgate pra quem faltou à reunião. */
const AUTO_FOLLOWUP_STATUSES: LeadStatus[] = [
  "primeiro_contato",
  "segundo_contato",
  "terceiro_contato",
  "no_show",
];

/** Status "de saída" do funil de contato — ao entrar neles não faz mais
 * sentido ter um follow-up pendente agendado, então ele é limpo. */
const CLEAR_FOLLOWUP_STATUSES: LeadStatus[] = [
  "finalizado",
  "desqualificado",
  "contrato_assinado",
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
  options: { explicitNextFollowup?: boolean } = {}
): StatusChangeUpdate {
  const nowIso = new Date().toISOString();
  const status_dates = { ...normalizeStatusDates(previousStatusDates), [newStatus]: nowIso };

  const update: StatusChangeUpdate = { status: newStatus, status_dates };

  if (!options.explicitNextFollowup) {
    if (AUTO_FOLLOWUP_STATUSES.includes(newStatus)) {
      const followup = new Date();
      followup.setUTCDate(followup.getUTCDate() + 2); // 48h, em termos de data (next_followup é `date`)
      update.next_followup = followup.toISOString().slice(0, 10);
    } else if (CLEAR_FOLLOWUP_STATUSES.includes(newStatus)) {
      update.next_followup = null;
    }
  }

  return update;
}
