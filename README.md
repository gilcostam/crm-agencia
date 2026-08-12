# CRM da Agência — No Limits

CRM interno da agência: funil de leads/prospecção, gestão de clientes ativos,
propostas & contratos e integração com WhatsApp (via n8n). Construído com
Next.js 16 + React 19 + Tailwind 4 + Supabase, seguindo a mesma arquitetura
do CRM já usado pela cliente Evellyn (`Clientes/Evellyn/crm-leads`).

## 1. Instalar dependências

```bash
npm install
```

## 2. Criar o projeto Supabase

1. Crie um projeto em [supabase.com](https://supabase.com) (ou reutilize um
   já existente, se preferir).
2. Abra **SQL Editor** no painel do projeto e rode o conteúdo de
   `supabase/schema.sql` inteiro. Isso cria as tabelas `leads`,
   `lead_events`, `lead_attachments`, `clients` e `proposals`, os índices,
   os triggers de `updated_at` e habilita Realtime + RLS.
3. (Opcional, só se for usar anexos de leads) Em **Storage**, crie um bucket
   chamado `lead-attachments`. Não precisa deixá-lo público — as rotas de
   anexo usam a `service_role` key e geram URLs assinadas temporárias.

## 3. Configurar variáveis de ambiente

Copie o arquivo de exemplo e preencha com os valores reais:

```bash
cp .env.local.example .env.local
```

Variáveis:

| Variável | Onde encontrar |
| --- | --- |
| `SUPABASE_URL` | Project Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → service_role key (secreta, nunca exponha no client) |
| `ADMIN_PASSWORD` | Senha que você escolhe para logar no dashboard |
| `SESSION_SECRET` | Uma string aleatória longa (ex.: `openssl rand -hex 32`) |
| `META_WEBHOOK_VERIFY_TOKEN` | Token que você inventa e usa também no painel do Meta (passo 4) |
| `META_APP_SECRET` | Meta for Developers → seu App → Configurações → Básico → Chave Secreta do Aplicativo |
| `META_PAGE_ACCESS_TOKEN` | Token de acesso da Página com permissão `leads_retrieval` |
| `N8N_WHATSAPP_WEBHOOK_URL` | URL do webhook do fluxo n8n "No Limits - Disparo Automático Meta Leads" (passo 5) |
| `WHATSAPP_WEBHOOK_SECRET` | Segredo compartilhado que o n8n deve enviar no header `X-Webhook-Secret` ao chamar `/api/webhook/whatsapp` de volta |

## 4. Rodar em desenvolvimento

```bash
npm run dev
```

Acesse `http://localhost:3000/login` e entre com a `ADMIN_PASSWORD` que você
definiu.

## 5. Importar os leads da prospecção existente (opcional)

O script `scripts/import_prospeccao_csv.py` importa os dados de
`Prospeccao BR USA-Canada/crm.csv` (pipeline standalone `crm.py`) para a
tabela `leads`, mapeando (por aproximação, já que os estágios não
correspondem 1:1) os status em português (Novo, Contatado, Respondeu, Demo
enviada, Negociando, Cliente ativo, Perdido, Cancelado) para o enum
snake_case do banco (Novo Lead, Primeiro Contato, Segundo Contato, Terceiro
Contato, Reunião Marcada, Contrato Assinado, Finalizado, Desqualificado).
Usa a coluna `chave` do CSV como `external_key`, então rodar o script mais de
uma vez **não duplica leads** — só atualiza.

```bash
python3 scripts/import_prospeccao_csv.py
# ou apontando pra outro caminho de CSV:
python3 scripts/import_prospeccao_csv.py "/caminho/para/crm.csv"
```

O script lê `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` do `.env.local` deste
projeto (ou de variáveis de ambiente já exportadas). Não precisa de nenhuma
dependência fora da biblioteca padrão do Python 3.

## 6. Configurar o webhook do Meta Lead Ads

1. Em [Meta for Developers](https://developers.facebook.com), no seu App,
   vá em **Webhooks** → **Page** → **Subscribe** e aponte a URL de callback
   para `https://SEU_DOMINIO/api/webhook/meta`.
2. Use o mesmo valor de `META_WEBHOOK_VERIFY_TOKEN` no campo "Verify Token"
   do painel — o handshake `GET` da rota confere esse token.
3. Assine o campo `leadgen` para a Página conectada ao seu formulário de
   anúncios.
4. Garanta que `META_PAGE_ACCESS_TOKEN` tenha a permissão `leads_retrieval`
   — sem ela, o lead ainda é salvo (com os dados que vierem no próprio
   evento do webhook), mas sem nome/telefone/e-mail completos vindos da
   Graph API.
5. Em produção, `META_APP_SECRET` precisa estar configurado para que a
   assinatura HMAC do payload (`X-Hub-Signature-256`) seja validada — sem
   isso, requisições não autenticadas são rejeitadas.

## 7. Configurar a integração de WhatsApp (n8n / Evolution API)

O fluxo n8n `No Limits - Disparo Automático Meta Leads`
(`Automação WhatsApp/fluxo_nolimits_leads.json`) dispara uma sequência de
mensagens (imediata, D+1, D+3, D+7) via Evolution API. A integração com
este CRM tem duas pontas:

- **CRM → n8n** (`N8N_WHATSAPP_WEBHOOK_URL`): ao clicar em "Disparar
  sequência WhatsApp" no detalhe de um lead (ou automaticamente, se você
  cablear isso na criação do lead), o CRM chama
  `POST {N8N_WHATSAPP_WEBHOOK_URL}` com `{ nome, telefone, cidade }` — o
  mesmo formato esperado pelo nó "Normalizar dados do lead" do fluxo. Copie
  a URL do nó de Webhook do fluxo publicado no n8n e cole aqui.
- **n8n → CRM** (`WHATSAPP_WEBHOOK_SECRET`): configure um nó HTTP Request no
  final de cada etapa da sequência do n8n para chamar de volta
  `POST https://SEU_DOMINIO/api/webhook/whatsapp` com o header
  `X-Webhook-Secret: <mesmo valor de WHATSAPP_WEBHOOK_SECRET>` e o corpo
  `{ "lead_id": "...", "type": "sent" | "reply", "message": "..." }` (pode
  usar `phone` no lugar de `lead_id` se for mais simples de montar no n8n).
  Isso registra o evento na timeline do lead e avança automaticamente o
  status de "Novo Lead" para "Primeiro Contato" no primeiro envio.

## 8. Build de produção

```bash
npm run build
npm run start
```

Deploy recomendado: Vercel (mesmo padrão de outros projetos da agência) —
não incluído/automatizado aqui, faça o deploy manualmente quando estiver
pronto.

## Estrutura

```
app/
  login/                     Tela de login (senha única de admin)
  dashboard/
    page.tsx, dashboard-client.tsx    Leads (kanban, 8 estágios: Novo Lead →
                                       Primeiro/Segundo/Terceiro Contato →
                                       Reunião Marcada → Contrato Assinado →
                                       Finalizado/Desqualificado)
    clientes/                         Clientes ativos
    propostas/                        Propostas & contratos (kanban)
    metricas/                         Funil, conversão, MRR
    _components/                      Sidebar, PropostaModal
  api/
    auth/                             Login/logout (cookie assinado HMAC)
    leads/                            CRUD + eventos + anexos + disparo WhatsApp
    clients/                          CRUD de clientes
    proposals/                        CRUD de propostas
    webhook/meta/                     Recebe leads do Meta Lead Ads
    webhook/whatsapp/                 Callback do n8n/Evolution API
lib/
  auth.ts, phone.ts, types.ts, supabase/server.ts
scripts/
  import_prospeccao_csv.py            Importa Prospeccao BR USA-Canada/crm.csv
supabase/
  schema.sql                          Schema completo (rodar no SQL Editor)
```
