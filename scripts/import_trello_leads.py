#!/usr/bin/env python3
"""
Importa os leads do board Trello de prospecção (leads médicos - tráfego
pago) para a tabela `leads` do Supabase do CRM da agência.

Uso:
    python3 scripts/import_trello_leads.py

Idempotente: usa `trello:<id do card>` como `external_key` e faz upsert com
onConflict=external_key, então rodar de novo não duplica — só atualiza os
leads já importados (útil pra reimportar depois de mudanças no board,
enquanto o webhook em tempo real não está publicado).

Credenciais: lê SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TRELLO_API_KEY,
TRELLO_TOKEN e TRELLO_BOARD_ID do arquivo .env.local na raiz do projeto (ou
de variáveis de ambiente já exportadas no shell).

Mapeamento de listas do Trello -> status do CRM (1:1, confirmado com o
usuário em 2026-08-12, board "Leads médicos - Tráfego pago 1"). O funil do
CRM foi alinhado às colunas reais do board, então cada lista mapeia direto
pro status equivalente do enum (sem colapsar tentativas de contato num único
status):
    Novo Lead           -> novo_lead
    Primeiro Contato    -> primeiro_contato
    Segundo contato     -> segundo_contato
    terceiro contato    -> terceiro_contato
    Reunião Marcada     -> reuniao_marcada (usa o "due" do card como
                           meeting_datetime, se houver)
    No Show             -> no_show (adicionado em 2026-09-01, lead faltou à
                           reunião marcada; entra entre reunião marcada e
                           diagnóstico enviado)
    Diagnóstico Enviado -> diagnostico_enviado (adicionado em 2026-08-28,
                           entre reunião marcada e contrato assinado)
    finalizado          -> finalizado (decisão do usuário: essa lista marca
                           processo de contato encerrado, não
                           necessariamente venda fechada — não usar
                           contrato_assinado aqui pra não criar clientes
                           fantasmas via conversão automática do CRM)
    Desqualificado      -> desqualificado

"Contrato Assinado" é um estágio exclusivo do CRM (não existe lista
correspondente no Trello) — nunca é usado como alvo deste mapeamento.

Se o board tiver listas novas que não aparecem no mapa acima, o script cai
em 'novo_lead' por padrão e avisa no log, pra nunca falhar a importação
inteira por causa de uma lista nova/renomeada.
"""
import json
import os
import re
import sys
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
    "no show": "no_show",
    "não compareceu": "no_show",
    "nao compareceu": "no_show",
    "diagnóstico enviado": "diagnostico_enviado",
    "diagnostico enviado": "diagnostico_enviado",
    "finalizado": "finalizado",
    "desqualificado": "desqualificado",
}

DESC_FIELD_PATTERN = re.compile(r"\*\*([^*:]+):\*\*\s*(.*)")


def load_env(path):
    """Lê pares KEY=VALUE de um .env.local simples (mesmo padrão usado em
    scripts/import_prospeccao_csv.py)."""
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


def trello_get(path, params, api_key, token):
    query = dict(params)
    query["key"] = api_key
    query["token"] = token
    url = f"https://api.trello.com/1/{path}?{urllib.parse.urlencode(query)}"
    try:
        with urllib.request.urlopen(url) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(f"Erro ao chamar API do Trello ({path}): HTTP {e.code} — {e.read().decode('utf-8')}")
        sys.exit(1)


def parse_desc_fields(desc):
    """Os cards desse board têm a descrição em formato
    '**Campo:** valor' por linha (gerado por um form externo de captação).
    Isso extrai isso num dict {campo_minusculo: valor}."""
    fields = {}
    for line in (desc or "").splitlines():
        m = DESC_FIELD_PATTERN.match(line.strip())
        if m:
            fields[m.group(1).strip().lower()] = m.group(2).strip()
    return fields


def build_lead_row(card, list_name):
    desc_fields = parse_desc_fields(card.get("desc"))
    normalized_list = list_name.strip().lower()
    status = LIST_NAME_TO_STATUS.get(normalized_list)
    if status is None:
        print(f"  aviso: lista '{list_name}' não mapeada, usando status 'novo_lead' pro card {card['id']}")
        status = "novo_lead"

    notes_parts = []
    company = desc_fields.get("company")
    if company:
        notes_parts.append(f"Empresa/Clínica: {company}")
    gmb = desc_fields.get("has google my business?")
    if gmb:
        notes_parts.append(f"Google Meu Negócio: {gmb}")
    challenge = desc_fields.get("biggest challenge")
    if challenge:
        notes_parts.append(f"Maior desafio: {challenge}")
    notes_parts.append(f"Lista original no Trello: {list_name}")

    meeting_datetime = card.get("due") if status == "reuniao_marcada" else None

    return {
        "external_key": f"trello:{card['id']}",
        "full_name": desc_fields.get("name") or card.get("name") or None,
        "phone": desc_fields.get("phone") or None,
        "city": desc_fields.get("city") or None,
        "category": desc_fields.get("specialty") or None,
        "status": status,
        "source": "trello",
        "notes": "\n".join(notes_parts) or None,
        "meeting_datetime": meeting_datetime,
        "raw_payload": {
            "_origem": "Importado via scripts/import_trello_leads.py a partir do "
            "board Trello de prospecção (leads médicos - tráfego pago).",
            "trello_card_id": card["id"],
            "trello_list_name": list_name,
            "trello_card": card,
        },
    }


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
        f"boards/{trello_board}/lists",
        {"fields": "id,name"},
        trello_key,
        trello_token,
    )
    list_name_by_id = {l["id"]: l["name"] for l in lists}

    print("Buscando cards do board no Trello...")
    cards = trello_get(
        f"boards/{trello_board}/cards",
        {"fields": "id,name,desc,due,idList"},
        trello_key,
        trello_token,
    )
    print(f"Cards encontrados: {len(cards)}")

    if not cards:
        print("Nada para importar.")
        return

    rows = [build_lead_row(card, list_name_by_id.get(card["idList"], "")) for card in cards]

    body = json.dumps(rows).encode("utf-8")
    url = f"{supabase_url}/rest/v1/leads?on_conflict=external_key"
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("apikey", service_key)
    req.add_header("Authorization", f"Bearer {service_key}")
    req.add_header("Content-Type", "application/json")
    req.add_header("Prefer", "resolution=merge-duplicates,return=representation")

    try:
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            print(f"Inseridos/atualizados com sucesso: {len(result)} leads.")
    except urllib.error.HTTPError as e:
        print(f"Erro HTTP {e.code}: {e.read().decode('utf-8')}")
        sys.exit(1)


if __name__ == "__main__":
    main()
