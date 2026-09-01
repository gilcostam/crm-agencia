export type LeadStatus =
  | "novo_lead"
  | "primeiro_contato"
  | "segundo_contato"
  | "terceiro_contato"
  | "reuniao_marcada"
  | "no_show"
  | "diagnostico_enviado"
  | "contrato_assinado"
  | "finalizado"
  | "desqualificado";

/** Valores de `Lead.source` que representam prospecção ativa (outbound) —
 * leads que a própria agência foi buscar (TNG Pesquisa/Maps, ou a extração
 * mais antiga via scripts/import_prospeccao_csv.py) — em vez de terem chegado
 * por tráfego pago (Meta Ads), Trello ou cadastro manual. Usado pra separar
 * o Kanban de "Leads" (tráfego pago) do menu "Prospecção Ativa" no dashboard
 * (ver app/dashboard/prospeccao/page.tsx e app/api/leads/route.ts). */
export const ACTIVE_PROSPECTING_SOURCES = ["tng_prospeccao", "prospeccao"] as const;

export interface Lead {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  category: string | null;
  status: LeadStatus;
  /** Data/hora (ISO) em que cada status foi alcançado pela última vez — não
   * inclui "novo_lead" (usar `created_at` pra isso). Preenchido
   * automaticamente pelo backend a cada mudança de status (ver
   * lib/lead-status.ts). Alimenta a linha do tempo de status no modal de
   * detalhe do lead. */
  status_dates: Partial<Record<LeadStatus, string>>;
  source: string;
  /** Chave de dedupe vinda da prospecção (crm.csv/crm.py) — normalmente a
   * URL do Google Maps do lead, ou nome+endereço quando não há link. */
  external_key: string | null;
  form_name: string | null;
  ad_name: string | null;
  campaign_name: string | null;
  leadgen_id: string | null;
  raw_payload: unknown;
  notes: string | null;
  meeting_datetime: string | null;
  /** Valor mensal estimado/negociado (recorrência SEO local + GEO). */
  monthly_value: number | null;
  /** Data do próximo follow-up planejado (yyyy-mm-dd). */
  next_followup: string | null;
  /** Preenchido quando este lead é uma duplicata confirmada de outro (aponta
   * pro id do lead original/canônico). Leads com esse campo preenchido são
   * tratados como inertes: ficam de fora do Kanban e das Métricas. */
  merged_into_lead_id: string | null;
  /** Preenchido quando este lead foi convertido automaticamente em Cliente
   * (ao entrar em status 'contrato_assinado' — ver app/api/leads/[id]/route.ts).
   * Aponta pro id do cliente criado. */
  converted_to_client_id: string | null;
  created_at: string;
  updated_at: string;
}

export const STATUS_LABELS: Record<LeadStatus, string> = {
  novo_lead: "Novo Lead",
  primeiro_contato: "Primeiro Contato",
  segundo_contato: "Segundo Contato",
  terceiro_contato: "Terceiro Contato",
  reuniao_marcada: "Reunião Marcada",
  no_show: "No Show",
  diagnostico_enviado: "Diagnóstico Enviado",
  contrato_assinado: "Contrato Assinado",
  finalizado: "Finalizado",
  desqualificado: "Desqualificado",
};

export const STATUS_ORDER: LeadStatus[] = [
  "novo_lead",
  "primeiro_contato",
  "segundo_contato",
  "terceiro_contato",
  "reuniao_marcada",
  "no_show",
  "diagnostico_enviado",
  "contrato_assinado",
  "finalizado",
  "desqualificado",
];

export interface LeadEvent {
  id: string;
  lead_id: string;
  /** 'status_change' | 'note' | 'meeting' | 'created' | 'value' | 'attachment'
   * | 'whatsapp_sent' | 'whatsapp_reply' */
  type: string;
  message: string;
  created_at: string;
}

export interface LeadAttachment {
  id: string;
  lead_id: string;
  file_name: string;
  storage_path: string;
  content_type: string | null;
  size_bytes: number | null;
  created_at: string;
  url?: string | null;
}

export type ClientStatus = "ativo" | "pausado" | "cancelado";

export const CLIENT_STATUS_LABELS: Record<ClientStatus, string> = {
  ativo: "Ativo",
  pausado: "Pausado",
  cancelado: "Cancelado",
};

export interface Client {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  document: string | null;
  category: string | null;
  city: string | null;
  monthly_value: number | null;
  status: ClientStatus;
  notes: string | null;
  source_lead_id: string | null;
  /** Início da vigência do contrato (yyyy-mm-dd). */
  contract_start_date: string | null;
  /** Fim da vigência do contrato (yyyy-mm-dd) — usado pra alertar quando o
   * contrato está perto de vencer (ver CONTRACT_WARNING_DAYS). */
  contract_end_date: string | null;
  created_at: string;
  updated_at: string;
}

/** Quantos dias antes do fim do contrato o alerta de renovação passa a
 * aparecer na UI. */
export const CONTRACT_WARNING_DAYS = 30;

export type ContractUrgency = "expired" | "warning" | "ok" | "unknown";

/** Classifica a vigência do contrato pra exibição (badge/alerta) na UI.
 * `today` deve ser uma string "yyyy-mm-dd" (mesmo formato das colunas date
 * do Postgres) pra comparação lexicográfica direta, sem fuso-horário. */
export function contractUrgency(
  contractEndDate: string | null,
  todayISODate: string
): ContractUrgency {
  if (!contractEndDate) return "unknown";
  if (contractEndDate < todayISODate) return "expired";
  const warningDate = new Date(`${todayISODate}T00:00:00`);
  warningDate.setDate(warningDate.getDate() + CONTRACT_WARNING_DAYS);
  const warningISODate = `${warningDate.getFullYear()}-${String(warningDate.getMonth() + 1).padStart(2, "0")}-${String(warningDate.getDate()).padStart(2, "0")}`;
  if (contractEndDate <= warningISODate) return "warning";
  return "ok";
}

export interface ClientAttachment {
  id: string;
  client_id: string;
  file_name: string;
  storage_path: string;
  content_type: string | null;
  size_bytes: number | null;
  created_at: string;
  url?: string | null;
}

export type TaskStatus = "pendente" | "em_andamento" | "concluida" | "cancelada";

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pendente: "Pendente",
  em_andamento: "Em andamento",
  concluida: "Concluída",
  cancelada: "Cancelada",
};

export type TaskCategory = "seo_local" | "avaliacoes" | "fotos" | "pendencias" | "outro";

export const TASK_CATEGORY_LABELS: Record<TaskCategory, string> = {
  seo_local: "SEO Local",
  avaliacoes: "Avaliações",
  fotos: "Fotos",
  pendencias: "Pendências",
  outro: "Outro",
};

export type TaskRecurrence = "semanal" | "mensal" | "continuo";

export const TASK_RECURRENCE_LABELS: Record<TaskRecurrence, string> = {
  semanal: "Semanal",
  mensal: "Mensal",
  continuo: "Contínuo",
};

export interface ClientTask {
  id: string;
  client_id: string;
  title: string;
  description: string | null;
  category: TaskCategory;
  responsible: string | null;
  due_date: string | null;
  recurrence: TaskRecurrence | null;
  status: TaskStatus;
  source_document: string | null;
  /** Preenchido automaticamente quando `status` vira 'concluida' (e limpo se
   * o status sair de 'concluida' de novo) — ver PATCH em
   * app/api/clients/[id]/tasks/[taskId]/route.ts. Usado pra montar a linha
   * do tempo de execução no painel de tarefas do cliente. */
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  /** Presente quando a API já faz o join com o cliente (listagem global). */
  client?: Pick<Client, "id" | "full_name"> | null;
}

/** Tarefa candidata sugerida pelo importador de documentos, ainda não salva. */
export interface ParsedClientTask {
  title: string;
  description: string | null;
  category: TaskCategory;
  responsible: string | null;
  due_date: string | null;
  recurrence: TaskRecurrence | null;
}

export type ProposalStatus =
  | "rascunho"
  | "enviada"
  | "em_negociacao"
  | "aceita"
  | "recusada"
  | "expirada";

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  rascunho: "Rascunho",
  enviada: "Enviada",
  em_negociacao: "Em negociação",
  aceita: "Aceita",
  recusada: "Recusada",
  expirada: "Expirada",
};

/** Ordem "ativa" do funil, usada no Kanban de Propostas — recusada/expirada
 * ficam de fora por não fazerem parte do fluxo normal (aparecem só na
 * listagem via o filtro/status explícito). */
export const PROPOSAL_STATUS_ORDER: ProposalStatus[] = [
  "rascunho",
  "enviada",
  "em_negociacao",
  "aceita",
];

export const PROPOSAL_STATUS_ALL: ProposalStatus[] = [
  ...PROPOSAL_STATUS_ORDER,
  "recusada",
  "expirada",
];

export const SERVICE_TYPE_SUGGESTIONS = [
  "SEO Local",
  "GEO (otimização para IAs)",
  "Google Meu Negócio",
  "Gestão de Redes Sociais",
  "Tráfego Pago",
  "Site institucional",
  "Blog / Conteúdo",
];

export interface Proposal {
  id: string;
  client_id: string | null;
  lead_id: string | null;
  title: string;
  service_type: string | null;
  value: number | null;
  recurring: boolean;
  status: ProposalStatus;
  sent_at: string | null;
  valid_until: string | null;
  contract_signed_at: string | null;
  contract_file_url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  /** Presente quando a API já faz o join com o cliente (listagem). */
  client?: Pick<Client, "id" | "full_name" | "phone" | "email"> | null;
}
