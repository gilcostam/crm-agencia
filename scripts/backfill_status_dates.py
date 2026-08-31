#!/usr/bin/env python3
"""
Reconstrói `leads.status_dates` (nova coluna jsonb — ver supabase/schema.sql e
lib/lead-status.ts) para leads que já existiam ANTES dessa coluna existir,
usando o histórico já registrado em `lead_events` (type='status_change').

Sem isso, leads antigos apareceriam com a "Linha do tempo de status" do
dashboard (app/dashboard/dashboard-client.tsx) vazia mesmo já tendo passado
por primeiro/segundo/terceiro contato de verdade — a data só existiria daqui
pra frente, a partir da mudança de status que o backend passou a registrar
automaticamente (PATCH /api/leads/[id] e o webhook do WhatsApp).

Como funciona: os eventos de mudança de status sempre têm a mensagem no
formato `Status alterado de "<label antigo>" para "<label novo>"` (ver
app/api/leads/[id]/route.ts e app/api/webhook/whatsapp/route.ts) — este
script varre esses eventos em ordem cronológica e, pra cada lead, usa a data
de cada transição pra preencher `status_dates[<status>]`. Se o mesmo lead
passou pelo mesmo status mais de uma vez (ex.: voltou de "Segundo Contato"
pra "Primeiro Contato" e foi de novo), fica a data da transição mais recente.

Idempotente e não-destrutivo: valores que já estiverem em `status_dates` (ex.:
transições que já aconteceram depois do deploy dessa feature, já registradas
pelo caminho novo) têm prioridade sobre o valor reconstruído do histórico —
nunca sobrescreve dado real mais preciso por uma reconstrução aproximada.
Rodar de novo não faz mal: leads sem histórico de status_change são pulados,
e leads já totalmente preenchidos não geram PATCH.

Uso:
    python3 scripts/backfill_status_dates.py [--dry-run]

Credenciais: mesmas dos outros scripts (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
em .env.local ou variáveis de ambiente).
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request


def load_env(path):
    env = {}
    if not os.path.exists(path):
        return env
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            env[key.strip()] = value.strip().strip('"')
    return env


# Precisa bater 1:1 com STATUS_LABELS em lib/types.ts.
LABEL_TO_STATUS = {
    "Novo Lead": "novo_lead",
    "Primeiro Contato": "primeiro_contato",
    "Segundo Contato": "segundo_contato",
    "Terceiro Contato": "terceiro_contato",
    "Reunião Marcada": "reuniao_marcada",
    "Diagnóstico Enviado": "diagnostico_enviado",
    "Contrato Assinado": "contrato_assinado",
    "Finalizado": "finalizado",
    "Desqualificado": "desqualificado",
}

VALID_STATUSES = set(LABEL_TO_STATUS.values())

# Formato do PATCH manual / webhook do WhatsApp (app/api/leads/[id]/route.ts,
# app/api/webhook/whatsapp/route.ts): usa os labels em português.
STATUS_CHANGE_RE = re.compile(r'Status alterado de "([^"]+)" para "([^"]+)"')

# Formato da sincronização reversa do Trello (scripts/sync_leads_to_trello.py
# ou equivalente): usa as chaves de status cruas (ex.: "novo_lead"), não os
# labels — separadas por "→".
TRELLO_SYNC_RE = re.compile(r"Status atualizado via Trello.*?:\s*(\w+)\s*→\s*(\w+)")


def extract_to_status(message):
    """Retorna a chave de status (`LeadStatus`) pra qual o lead foi movido
    nesse evento, tentando os dois formatos de mensagem conhecidos, ou None
    se a mensagem não for uma transição de status reconhecível."""
    m = STATUS_CHANGE_RE.search(message or "")
    if m:
        return LABEL_TO_STATUS.get(m.group(2))

    m = TRELLO_SYNC_RE.search(message or "")
    if m and m.group(2) in VALID_STATUSES:
        return m.group(2)

    return None


def api_get(base_url, headers, path):
    """GET com paginação via Range, pra não depender do limite default de
    1000 linhas do PostgREST caso a tabela cresça além disso."""
    results = []
    offset = 0
    page_size = 1000
    while True:
        req = urllib.request.Request(f"{base_url}{path}", method="GET")
        for k, v in headers.items():
            req.add_header(k, v)
        req.add_header("Range-Unit", "items")
        req.add_header("Range", f"{offset}-{offset + page_size - 1}")
        try:
            with urllib.request.urlopen(req) as resp:
                page = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            print(f"Erro HTTP {e.code} em GET {path}: {e.read().decode('utf-8')}")
            sys.exit(1)
        results.extend(page)
        if len(page) < page_size:
            break
        offset += page_size
    return results


def main():
    dry_run = "--dry-run" in sys.argv

    project_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    env = load_env(os.path.join(project_dir, ".env.local"))

    supabase_url = env.get("SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    service_key = env.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if not supabase_url or not service_key:
        print(
            "Faltam credenciais: defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY em "
            ".env.local (na raiz do projeto) ou como variáveis de ambiente antes de rodar."
        )
        sys.exit(1)

    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }

    print("Buscando leads...")
    leads = api_get(supabase_url, headers, "/rest/v1/leads?select=id,status_dates")
    leads_by_id = {lead["id"]: lead for lead in leads}
    print(f"  {len(leads)} leads encontrados.")

    print("Buscando histórico de mudança de status (lead_events)...")
    events = api_get(
        supabase_url,
        headers,
        "/rest/v1/lead_events?type=eq.status_change&select=lead_id,message,created_at&order=created_at.asc",
    )
    print(f"  {len(events)} eventos de status_change encontrados.")

    reconstructed = {}  # lead_id -> {status: iso_date}
    unmatched = 0
    for ev in events:
        to_status = extract_to_status(ev["message"])
        if not to_status:
            unmatched += 1
            continue
        lead_id = ev["lead_id"]
        reconstructed.setdefault(lead_id, {})[to_status] = ev["created_at"]

    if unmatched:
        print(f"  {unmatched} eventos não bateram com o padrão esperado (ignorados).")

    to_update = []
    for lead_id, computed in reconstructed.items():
        lead = leads_by_id.get(lead_id)
        if not lead:
            continue  # lead pode ter sido removido/mesclado desde então
        current = lead.get("status_dates") or {}
        # Dado real (já gravado pelo caminho novo) sempre tem prioridade sobre
        # a reconstrução aproximada a partir do histórico de eventos.
        merged = {**computed, **current}
        if merged != current:
            to_update.append((lead_id, merged))

    print(f"\nLeads com status_dates a preencher/completar: {len(to_update)}")

    if not to_update:
        print("Nada para atualizar.")
        return

    if dry_run:
        print("\n--dry-run: nenhuma alteração será enviada. Exemplos:")
        for lead_id, merged in to_update[:5]:
            print(f"  {lead_id}: {merged}")
        return

    ok_count = 0
    for lead_id, merged in to_update:
        body = json.dumps({"status_dates": merged}).encode("utf-8")
        req = urllib.request.Request(
            f"{supabase_url}/rest/v1/leads?id=eq.{lead_id}", data=body, method="PATCH"
        )
        for k, v in headers.items():
            req.add_header(k, v)
        req.add_header("Prefer", "return=minimal")
        try:
            with urllib.request.urlopen(req):
                ok_count += 1
        except urllib.error.HTTPError as e:
            print(f"  Erro ao atualizar lead {lead_id}: HTTP {e.code} {e.read().decode('utf-8')}")

    print(f"\nAtualizados com sucesso: {ok_count}/{len(to_update)} leads.")


if __name__ == "__main__":
    main()
