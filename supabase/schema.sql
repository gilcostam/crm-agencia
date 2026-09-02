-- Schema do CRM interno da agência No Limits.
-- Rode isso no SQL Editor do seu projeto Supabase.

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  full_name text,
  email text,
  phone text,
  city text,
  category text,
  status text not null default 'novo_lead' check (
    status in (
      'novo_lead',
      'primeiro_contato',
      'segundo_contato',
      'terceiro_contato',
      'reuniao_marcada',
      'no_show',
      'diagnostico_enviado',
      'contrato_assinado',
      'retornar_depois',
      'finalizado',
      'desqualificado'
    )
  ),
  source text not null default 'manual',
  -- Chave de dedupe vinda da prospecção (crm.csv/crm.py) — normalmente a URL
  -- do Google Maps do lead, ou nome+endereço quando não há link.
  external_key text,
  form_name text,
  ad_name text,
  campaign_name text,
  leadgen_id text,
  raw_payload jsonb,
  notes text,
  meeting_datetime timestamptz,
  -- Valor mensal estimado/negociado (recorrência SEO local + GEO).
  monthly_value numeric(12, 2),
  -- Data do próximo follow-up planejado.
  next_followup date,
  merged_into_lead_id uuid references public.leads(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists leads_status_idx on public.leads (status);
create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists leads_meeting_datetime_idx on public.leads (meeting_datetime);
create index if not exists leads_merged_into_lead_id_idx on public.leads (merged_into_lead_id);

-- Dedupe do import da prospecção (scripts/import_prospeccao_csv.py e
-- scripts/import_trello_leads.py, ambos fazem upsert com
-- onConflict=external_key). Índice único "normal" (não parcial): no
-- Postgres, NULL nunca é considerado igual a outro NULL mesmo em índice
-- único não-parcial, então múltiplos leads sem external_key continuam
-- permitidos sem precisar de WHERE — e isso é obrigatório pro Supabase/
-- PostgREST conseguir usar ON CONFLICT (índices únicos parciais não
-- funcionam como alvo de ON CONFLICT via PostgREST, que não repete a
-- cláusula WHERE na query gerada).
create unique index if not exists leads_external_key_unique_idx
  on public.leads (external_key);

-- Dedupe do webhook do Meta Lead Ads (app/api/webhook/meta/route.ts faz
-- upsert com onConflict: "leadgen_id") — mesmo motivo acima.
create unique index if not exists leads_leadgen_id_unique_idx
  on public.leads (leadgen_id);

-- Atualiza updated_at automaticamente
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists leads_set_updated_at on public.leads;
create trigger leads_set_updated_at
  before update on public.leads
  for each row
  execute function public.set_updated_at();

-- Habilita Realtime para a tabela (leads aparecem ao vivo no dashboard).
-- Guardado com um check porque "alter publication ... add table" não é
-- idempotente (dá erro se a tabela já estiver na publicação, ao contrário
-- de "create table if not exists").
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'leads'
  ) then
    alter publication supabase_realtime add table public.leads;
  end if;
end $$;

-- RLS: bloqueia acesso público direto. O webhook e as API routes usam a
-- service_role key (que ignora RLS), então não precisamos de policies
-- públicas aqui.
alter table public.leads enable row level security;

-- Histórico de eventos por lead (mudança de status, notas, reunião,
-- WhatsApp) — timeline exibida no modal de detalhe do lead.
create table if not exists public.lead_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  -- 'status_change' | 'note' | 'meeting' | 'created' | 'value' | 'attachment'
  -- | 'whatsapp_sent' | 'whatsapp_reply'
  type text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists lead_events_lead_id_idx on public.lead_events (lead_id, created_at desc);

alter table public.lead_events enable row level security;

-- Anexos por lead (arquivos enviados pra equipe, guardados no Supabase Storage).
create table if not exists public.lead_attachments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  content_type text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);

create index if not exists lead_attachments_lead_id_idx on public.lead_attachments (lead_id, created_at desc);

alter table public.lead_attachments enable row level security;

-- Clientes ativos da agência. Um lead que entra em "contrato_assinado" é
-- convertido automaticamente em Cliente (ver app/api/leads/[id]/route.ts).
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text,
  phone text,
  document text,
  category text,
  city text,
  monthly_value numeric(12, 2),
  status text not null default 'ativo' check (status in ('ativo', 'pausado', 'cancelado')),
  notes text,
  source_lead_id uuid references public.leads(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists clients_full_name_idx on public.clients (full_name);
create index if not exists clients_status_idx on public.clients (status);
create index if not exists clients_source_lead_id_idx on public.clients (source_lead_id);

drop trigger if exists clients_set_updated_at on public.clients;
create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

alter table public.clients enable row level security;

-- Propostas e contratos (substitui "projects" da Evellyn — cobre proposta E
-- contrato/assinatura). Pode estar ligada a um cliente já existente e/ou ao
-- lead de origem.
create table if not exists public.proposals (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  title text not null,
  service_type text,
  value numeric(12, 2),
  recurring boolean not null default false,
  status text not null default 'rascunho' check (
    status in ('rascunho', 'enviada', 'em_negociacao', 'aceita', 'recusada', 'expirada')
  ),
  sent_at date,
  valid_until date,
  contract_signed_at date,
  contract_file_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists proposals_client_id_idx on public.proposals (client_id);
create index if not exists proposals_lead_id_idx on public.proposals (lead_id);
create index if not exists proposals_status_idx on public.proposals (status);
create index if not exists proposals_created_at_idx on public.proposals (created_at desc);

drop trigger if exists proposals_set_updated_at on public.proposals;
create trigger proposals_set_updated_at
  before update on public.proposals
  for each row execute function public.set_updated_at();

alter table public.proposals enable row level security;

-- Rastreia se um lead já foi convertido em cliente (evita duplicar a
-- conversão automática e mostra o link "Ver na lista de clientes" na UI).
-- Fica no fim do arquivo porque referencia public.clients, criada acima.
alter table public.leads
  add column if not exists converted_to_client_id uuid references public.clients(id) on delete set null;

create index if not exists leads_converted_to_client_id_idx on public.leads (converted_to_client_id);

-- Anexos por cliente (mesmo padrão de lead_attachments) — arquivos e
-- relatórios enviados pela equipe (ex.: prévia de Perfil de Empresa no
-- Google), guardados no Supabase Storage.
create table if not exists public.client_attachments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  content_type text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);

create index if not exists client_attachments_client_id_idx on public.client_attachments (client_id, created_at desc);

alter table public.client_attachments enable row level security;

-- Rotina de trabalho por cliente: tarefas com prazo/responsável/recorrência,
-- consultadas pelos executores da agência (tela /dashboard/tarefas) e no
-- detalhe de cada cliente. Podem ser criadas manualmente ou importadas
-- automaticamente a partir de um documento (ex.: plano de SEO local de um
-- relatório de Perfil de Empresa no Google — ver app/api/clients/[id]/tasks/import).
create table if not exists public.client_tasks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  title text not null,
  description text,
  -- 'seo_local' | 'avaliacoes' | 'fotos' | 'pendencias' | 'outro'
  category text not null default 'outro',
  -- responsável: texto livre (ex.: "Gilmara", "Cliente", "No Limits Marketing Estratégico")
  responsible text,
  due_date date,
  -- null (tarefa pontual) | 'semanal' | 'mensal' | 'continuo'
  recurrence text,
  status text not null default 'pendente' check (
    status in ('pendente', 'em_andamento', 'concluida', 'cancelada')
  ),
  -- nome do documento de origem, quando a tarefa foi criada via importação automática
  source_document text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists client_tasks_client_id_idx on public.client_tasks (client_id, due_date);
create index if not exists client_tasks_status_idx on public.client_tasks (status);
create index if not exists client_tasks_due_date_idx on public.client_tasks (due_date);

drop trigger if exists client_tasks_set_updated_at on public.client_tasks;
create trigger client_tasks_set_updated_at
  before update on public.client_tasks
  for each row execute function public.set_updated_at();

alter table public.client_tasks enable row level security;

-- Período de vigência do contrato do cliente — usado pra alertar na UI
-- quando um contrato está perto de vencer ou já venceu (ver
-- app/dashboard/clientes/clientes-client.tsx). Fica no fim do arquivo, como
-- converted_to_client_id acima, pra não mexer na definição original da
-- tabela.
alter table public.clients
  add column if not exists contract_start_date date;
alter table public.clients
  add column if not exists contract_end_date date;

create index if not exists clients_contract_end_date_idx on public.clients (contract_end_date);

-- Timestamp de quando a tarefa foi marcada como concluída — preenchido pelo
-- PATCH em app/api/clients/[id]/tasks/[taskId]/route.ts sempre que `status`
-- vira 'concluida' (e limpo se sair de novo). Alimenta a "Linha do tempo de
-- execução" no painel completo de tarefas do cliente (ver
-- app/dashboard/clientes/ClientTasksPanel.tsx).
alter table public.client_tasks
  add column if not exists completed_at timestamptz;

-- Guarda, por lead, a data/hora em que cada status foi alcançado pela
-- primeira/última vez (ex.: {"primeiro_contato": "2026-08-20T14:03:00Z",
-- "segundo_contato": "...", ...}) — "novo_lead" não entra aqui, usa-se
-- leads.created_at pra isso. Preenchido automaticamente sempre que o status
-- muda (ver lib/lead-status.ts, usado por app/api/leads/[id]/route.ts e
-- app/api/webhook/whatsapp/route.ts) e alimenta a "Linha do tempo de status"
-- no modal de detalhe do lead (app/dashboard/dashboard-client.tsx) — dá pra
-- ver quando o lead chegou, quando foi o 1º/2º/3º contato etc.
alter table public.leads
  add column if not exists status_dates jsonb not null default '{}'::jsonb;
