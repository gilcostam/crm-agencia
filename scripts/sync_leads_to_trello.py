#!/usr/bin/env python3
"""
Sincronização reversa (CRM -> Trello): varre todos os leads do Supabase que
vieram do Trello (external_key = "trello:<id do card>") e move cada card pra
lista que corresponde ao status atual do lead no CRM.

Complementa app/api/leads/[id]/route.ts + lib/trello.ts (que fazem essa mesma
sincronização de forma incremental, a cada PATCH feito pelo dashboard) — este
script serve pra corrigir de uma vez qualquer drift acumulado antes desse
código existir/entrar em produção (ex.: leads que mudaram de status no CRM
enquanto a sincronização reversa ainda não existia).

Uso:
    python3 scripts/sync_leads_to_trello.py

Idempotente: cards que já estão na lista certa são pulados (sem chamada de
escrita). Nunca falha a execução inteira por causa de um card só — erros
pontuais são logados e a varredura continua.

Credenciais: mesmas de scripts/import_trello_leads.py, lidas de .env.local
(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TRELLO_API_KEY, TRELLO_TOKEN,
TRELLO_BOARD_ID).

"contrato_assinado" não tem lista correspondente no Trello (decisão
confirmada com o usuário — ver docstring de import_trello_leads.py), então
leads nesse status são pulados sem erro.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

LIST_NAME_TO_STATUS = {
    "novo lead": "novo_lead",
    "primeiro contato": "primeiro_contato",
    "segundo contato": "segundo_contato",
    "terceiro contato": "terceiro_contato",
    "reunião marcada": "reuniao_marcada",
    "reuniao marcada": "reuniao_marcada",
    "diagnóstico enviado": "diagnostico_enviado",
    "diagnostico enviado": "diagnostico_enviado",
    "finalizado": "finalizado",
    "desqualificado": "desqualificado",
}

REQUEST_DELAY_SECONDS = 0.15  # respeita o rate limit da API do Trello


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


def trello_get(url):
    try:
        with urllib.request.urlopen(url) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(f"  erro HTTP {e.code} ao chamar {url.split('?')[0]}: {e.read().decode('utf-8')}")
        return None


def trello_put(url):
    req = urllib.request.Request(url, method="PUT")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(f"  erro HTTP {e.code} ao mover card: {e.read().decode('utf-8')}")
        return None


def main():
    project_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    env = load_env(os.path.join(project_dir, ".env.local"))

    def get(name):
        return env.get(name) or os.environ.get(name)

    supabase_url = get("SUPABASE_URL")
    service_key = get("SUPABASE_SERVICE_ROLE_KEY")
    trello_key = get("TRELLO_API_KEY")
    trello_token = get("TRELLO_TOKEN")
    trello_board = get("TRELLO_BOARD_ID")

    missing = [
        name
        for name, value in [
            ("SUPABASE_URL", supabase_url),
            ("SUPABASE_SERVICE_ROLE_KEY", service_key),
            ("TRELLO_API_KEY", trello_key),
            ("TRELLO_TOKEN", trello_token),
            ("TRELLO_BOARD_ID", trello_board),
        ]
        if not value
    ]
    if missing:
        print("Faltam variáveis em .env.local: " + ", ".join(missing))
        sys.exit(1)

    print("Buscando listas do board no Trello...")
    lists = trello_get(
        f"https://api.trello.com/1/boards/{trello_board}/lists"
        f"?fields=id,name&key={trello_key}&token={trello_token}"
    )
    if lists is None:
        sys.exit(1)

    status_to_list_id = {}
    for l in lists:
        status = LIST_NAME_TO_STATUS.get(l["name"].strip().lower())
        if status and status not in status_to_list_id:
            status_to_list_id[status] = l["id"]

    print("Buscando leads vindos do Trello no Supabase...")
    query = urllib.parse.urlencode(
        {
            "external_key": "like.trello:*",
            "merged_into_lead_id": "is.null",
            "select": "id,external_key,status,full_name",
        },
        safe="*:,.",
    )
    leads_url = f"{supabase_url}/rest/v1/leads?{query}"
    req = urllib.request.Request(leads_url)
    req.add_header("apikey", service_key)
    req.add_header("Authorization", f"Bearer {service_key}")
    try:
        with urllib.request.urlopen(req) as resp:
            leads = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(f"Erro HTTP {e.code} ao buscar leads: {e.read().decode('utf-8')}")
        sys.exit(1)

    print(f"Leads vindos do Trello encontrados: {len(leads)}")

    moved = 0
    already_correct = 0
    skipped_no_list = 0
    errors = 0

    for lead in leads:
        status = lead.get("status")
        external_key = lead.get("external_key") or ""
        card_id = external_key.split("trello:", 1)[-1]
        name = lead.get("full_name") or card_id

        target_list_id = status_to_list_id.get(status)
        if not target_list_id:
            skipped_no_list += 1
            continue

        card = trello_get(
            f"https://api.trello.com/1/cards/{card_id}"
            f"?fields=idList&key={trello_key}&token={trello_token}"
        )
        time.sleep(REQUEST_DELAY_SECONDS)
        if card is None:
            errors += 1
            continue

        if card.get("idList") == target_list_id:
            already_correct += 1
            continue

        result = trello_put(
            f"https://api.trello.com/1/cards/{card_id}"
            f"?idList={target_list_id}&key={trello_key}&token={trello_token}"
        )
        time.sleep(REQUEST_DELAY_SECONDS)
        if result is None:
            errors += 1
            continue

        moved += 1
        print(f"  movido: {name} -> status '{status}'")

    print("\nResumo:")
    print(f"  movidos agora: {moved}")
    print(f"  já estavam corretos: {already_correct}")
    print(f"  sem lista correspondente no Trello (ex.: contrato_assinado): {skipped_no_list}")
    print(f"  erros: {errors}")


if __name__ == "__main__":
    main()
