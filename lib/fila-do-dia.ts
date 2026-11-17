import { CONTACT_PROOF_STATUSES, LOSS_STATUSES, nuncaFoiContatado } from "./lead-status";
import { Lead, LeadStatus } from "./types";

/** A fila do dia: a lista ordenada de quem falar HOJE, e por quê.
 *
 * Por que existe, medido na base em 17/11/2026: o Kanban mostra mais de 200
 * cards em negociação, e nele tudo parece igualmente urgente. Quando tudo
 * parece igual, a decisão de quem trabalhar vira "de quem eu lembro", e o
 * resultado aparece nos números: 147 dos 210 leads em negociação estavam com
 * follow-up vencido, a mediana entre o último contato e ser dado como
 * perdido era de 2 dias, e 215 dos 487 leads perdidos nunca receberam uma
 * mensagem.
 *
 * O quadro não some: ele continua sendo onde se vê o funil. A fila responde
 * outra pergunta, uma só, que o quadro não responde: por onde começar agora.
 */

export type MotivoFila =
  | "reuniao_hoje_sem_confirmacao"
  | "reuniao_proxima_sem_confirmacao"
  | "diagnostico_parado"
  | "no_show_sem_resgate"
  | "followup_vencido"
  | "followup_hoje"
  | "inbound_sem_contato";

export const MOTIVO_LABELS: Record<MotivoFila, string> = {
  reuniao_hoje_sem_confirmacao: "Reunião hoje, sem confirmação",
  reuniao_proxima_sem_confirmacao: "Reunião nas próximas 48h, sem confirmação",
  diagnostico_parado: "Diagnóstico enviado e sem retorno",
  no_show_sem_resgate: "Faltou à reunião e não foi resgatado",
  followup_vencido: "Follow-up vencido",
  followup_hoje: "Follow-up marcado pra hoje",
  inbound_sem_contato: "Pediu contato e nunca foi atendido",
};

/** Por que cada motivo está nessa posição, em uma frase, pra aparecer na
 * própria tela — a ordem não deve ser uma caixa-preta pra quem usa. */
export const MOTIVO_POR_QUE: Record<MotivoFila, string> = {
  reuniao_hoje_sem_confirmacao:
    "Das 41 reuniões da base, as 22 confirmadas deram 18% de no-show e as 19 não confirmadas deram 58%. É a única coisa medida que muda a presença.",
  reuniao_proxima_sem_confirmacao:
    "Mesma razão, com mais folga: dá tempo de confirmar e, se ela não puder, de remarcar em vez de perder o horário.",
  diagnostico_parado:
    "É o ponto mais perto da venda em todo o funil: o lead já viu a análise e já sabe que está atrás dos concorrentes.",
  no_show_sem_resgate:
    "Faltar não é dizer não. Dos 15 no-show da base, nenhum foi dado como perdido por ter recusado algo.",
  followup_vencido:
    "A cadência foi combinada em 48h entre contatos. Passou disso, o lead esfria e a próxima mensagem começa do zero.",
  followup_hoje: "É a data que você mesma marcou pra voltar nesse lead.",
  inbound_sem_contato:
    "Esse lead preencheu um formulário pedindo contato. 215 dos 487 leads perdidos saíram da base sem receber uma mensagem, e 201 deles vinham daqui.",
};

export interface ItemFila {
  lead: Lead;
  motivo: MotivoFila;
  /** Texto curto de contexto já pronto pra tela (ex.: "vencido há 12 dias"). */
  detalhe: string;
  /** Dias desde o último sinal de vida registrado — `null` quando não há. */
  diasDeSilencio: number | null;
  /** Dias de atraso do `next_followup` (0 quando vence hoje ou não há). */
  diasDeAtraso: number;
}

/** Acima de quantos dias de atraso um lead deixa de ser fila e passa a ser
 * decisão. Um lead parado há 2 meses não se resolve com a mensagem do dia:
 * ou entra num resgate em lote, ou sai da base. Misturá-lo na fila diária
 * faz o pior dos dois mundos, enterra os leads que ainda dá pra salvar
 * embaixo dos que já não dá, e é exatamente o que o Kanban já fazia. */
export const DIAS_PARA_SAIR_DA_FILA = 30;

export interface FilaDoDia {
  /** O que fazer hoje, em ordem. */
  fila: ItemFila[];
  /** Leads vencidos há mais de DIAS_PARA_SAIR_DA_FILA — ficam fora da fila
   * de propósito, e aparecem na tela como um número e uma pergunta, não como
   * tarefa do dia. */
  parados: ItemFila[];
}

/** Ordem dos motivos. Primeiro o que tem hora marcada e não volta (reuniões
 * de hoje), depois o que está mais perto do dinheiro, e por último o estoque
 * que não tem prazo nenhum — importante, mas que nunca deve empurrar pra
 * baixo uma reunião que acontece em três horas. */
const ORDEM_MOTIVOS: MotivoFila[] = [
  "reuniao_hoje_sem_confirmacao",
  "diagnostico_parado",
  "no_show_sem_resgate",
  "reuniao_proxima_sem_confirmacao",
  "followup_vencido",
  "followup_hoje",
  "inbound_sem_contato",
];

/** Sources que chegaram pedindo contato (inbound) — são os leads em que
 * "nunca contatado" é prejuízo puro, não triagem. Trello é o quadro onde
 * caem os formulários, e é o único canal que já gerou contrato. */
const INBOUND_SOURCES = new Set(["trello", "meta_ads", "manual"]);

function diasEntre(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / 86_400_000);
}

function plural(n: number, singular: string, pluralForm: string): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

/** Último momento em que esse lead deu ou recebeu algum sinal registrado:
 * a data mais recente em `status_dates` entre os status que provam contato,
 * caindo pra `updated_at` quando não há nenhum. */
function ultimoSinal(lead: Lead): Date | null {
  const sd = lead.status_dates ?? {};
  const datas = CONTACT_PROOF_STATUSES.map((s) => sd[s as LeadStatus])
    .filter((v): v is string => Boolean(v))
    .map((v) => new Date(v))
    .filter((d) => !Number.isNaN(d.getTime()));
  if (datas.length === 0) return null;
  return new Date(Math.max(...datas.map((d) => d.getTime())));
}

/** Classifica um lead num motivo de fila, ou `null` se ele não precisa de
 * nada hoje. A ordem dos `if` aqui importa: um lead com reunião hoje sem
 * confirmação E follow-up vencido entra como reunião, que é o que tem hora
 * marcada. */
function motivoDoLead(
  lead: Lead,
  confirmado: boolean,
  hojeISO: string,
  agora: Date
): MotivoFila | null {
  if (LOSS_STATUSES.includes(lead.status) || lead.status === "contrato_assinado") return null;

  if (lead.status === "reuniao_marcada" && lead.meeting_datetime && !confirmado) {
    const reuniao = new Date(lead.meeting_datetime);
    if (!Number.isNaN(reuniao.getTime())) {
      const horas = (reuniao.getTime() - agora.getTime()) / 3_600_000;
      const mesmoDia =
        reuniao.getFullYear() === agora.getFullYear() &&
        reuniao.getMonth() === agora.getMonth() &&
        reuniao.getDate() === agora.getDate();
      if (mesmoDia && horas > -2) return "reuniao_hoje_sem_confirmacao";
      if (horas > 0 && horas <= 48) return "reuniao_proxima_sem_confirmacao";
    }
  }

  const followupVencido = Boolean(lead.next_followup && lead.next_followup < hojeISO);
  const followupHoje = lead.next_followup === hojeISO;

  if (lead.status === "diagnostico_enviado" && (followupVencido || followupHoje)) {
    return "diagnostico_parado";
  }

  if (lead.status === "no_show" && (followupVencido || followupHoje)) {
    return "no_show_sem_resgate";
  }

  if (followupVencido) return "followup_vencido";
  if (followupHoje) return "followup_hoje";

  /* O estoque inbound: pediu contato, tem telefone e nunca recebeu nada.
     Só entra quando o lead ainda está em "novo_lead" — se já andou no funil
     e não tem follow-up marcado, é um caso pra decidir, não pra fila. */
  if (
    lead.status === "novo_lead" &&
    INBOUND_SOURCES.has(lead.source) &&
    (lead.phone ?? "").trim() &&
    nuncaFoiContatado(lead.status_dates)
  ) {
    return "inbound_sem_contato";
  }

  return null;
}

function detalheDoItem(
  lead: Lead,
  motivo: MotivoFila,
  dias: number | null,
  agora: Date
): string {
  if (
    motivo === "reuniao_hoje_sem_confirmacao" ||
    motivo === "reuniao_proxima_sem_confirmacao"
  ) {
    if (!lead.meeting_datetime) return "sem horário definido";
    const d = new Date(lead.meeting_datetime);
    const horas = Math.round((d.getTime() - agora.getTime()) / 3_600_000);
    const quando = d.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    if (horas < 0) return `era às ${quando}, já passou`;
    if (horas < 1) return `${quando}, em menos de uma hora`;
    return `${quando}, em ${plural(horas, "hora", "horas")}`;
  }

  if (motivo === "inbound_sem_contato") {
    const d = new Date(lead.created_at);
    const esperando = Number.isNaN(d.getTime()) ? null : diasEntre(agora, d);
    return esperando === null
      ? "nenhuma mensagem registrada"
      : `esperando há ${plural(esperando, "dia", "dias")}, nenhuma mensagem`;
  }

  if (lead.next_followup) {
    const venc = new Date(`${lead.next_followup}T00:00:00`);
    const atraso = diasEntre(agora, venc);
    if (atraso > 0) {
      /* O silêncio só entra quando conta outra história que o atraso: nos
         casos normais os dois números são quase iguais e repeti-los na mesma
         linha só ocupa espaço ("vencido há 78 dias, 78 dias sem falar"). */
      const silencio =
        dias !== null && Math.abs(dias - atraso) > 3
          ? `, ${plural(dias, "dia", "dias")} sem falar`
          : "";
      return `follow-up vencido há ${plural(atraso, "dia", "dias")}${silencio}`;
    }
    return dias !== null ? `${plural(dias, "dia", "dias")} sem falar` : "pra hoje";
  }

  return dias !== null ? `${plural(dias, "dia", "dias")} sem falar` : "";
}

/** Monta a fila ordenada.
 *
 * `confirmacoes` é o mapa `leadId -> data ISO` de quem já recebeu uma
 * mensagem de confirmação de reunião, derivado da timeline (ver
 * noteEhConfirmacao em lib/whatsapp-templates.ts). Quem já foi confirmado
 * sai da fila: a mensagem já foi mandada, mandar de novo é ruído.
 */
export function montarFilaDoDia(
  leads: Lead[],
  confirmacoes: Record<string, string>,
  agora: Date = new Date()
): FilaDoDia {
  const hojeISO = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}-${String(agora.getDate()).padStart(2, "0")}`;

  const itens: ItemFila[] = [];
  for (const lead of leads) {
    if (lead.merged_into_lead_id) continue;
    const motivo = motivoDoLead(lead, Boolean(confirmacoes[lead.id]), hojeISO, agora);
    if (!motivo) continue;
    const sinal = ultimoSinal(lead);
    const dias = sinal ? diasEntre(agora, sinal) : null;
    const atraso = lead.next_followup
      ? Math.max(0, diasEntre(agora, new Date(`${lead.next_followup}T00:00:00`)))
      : 0;
    itens.push({
      lead,
      motivo,
      diasDeSilencio: dias,
      diasDeAtraso: atraso,
      detalhe: detalheDoItem(lead, motivo, dias, agora),
    });
  }

  /* Dentro do mesmo motivo: reuniões pela hora (a mais próxima primeiro) e
     todo o resto pelo MENOR atraso primeiro.
     
     A ordem contrária, "quem está parado há mais tempo vem antes", é a
     tentadora e é a errada. O que a base mostra é que a agência desiste
     rápido: a mediana entre o último contato e dar o lead como perdido é de
     2 dias. Quem está vencido há 3 dias ainda lembra da conversa e volta;
     quem está parado há 78 dias precisa de um resgate em lote, não da
     mensagem de hoje. Ordenar pelo silêncio mais longo colocaria os leads
     menos salváveis exatamente nas melhores horas do dia. */
  const ordenar = (lista: ItemFila[]) =>
    lista.sort((a, b) => {
      const ordem = ORDEM_MOTIVOS.indexOf(a.motivo) - ORDEM_MOTIVOS.indexOf(b.motivo);
      if (ordem !== 0) return ordem;
      if (a.lead.meeting_datetime && b.lead.meeting_datetime) {
        return (
          new Date(a.lead.meeting_datetime).getTime() -
          new Date(b.lead.meeting_datetime).getTime()
        );
      }
      return a.diasDeAtraso - b.diasDeAtraso;
    });

  return {
    fila: ordenar(itens.filter((i) => i.diasDeAtraso <= DIAS_PARA_SAIR_DA_FILA)),
    parados: ordenar(itens.filter((i) => i.diasDeAtraso > DIAS_PARA_SAIR_DA_FILA)),
  };
}
