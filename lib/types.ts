export type LeadStatus =
  | "novo_lead"
  | "primeiro_contato"
  | "segundo_contato"
  | "terceiro_contato"
  | "reuniao_marcada"
  | "contrato_assinado"
  | "finalizado"
  | "desqualificado";

export interface Lead {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  category: string | null;
  status: LeadStatus;
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
  created_at: string;
  updated_at: string;
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
