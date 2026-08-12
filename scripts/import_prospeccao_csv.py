#!/usr/bin/env python3
"""
Importa os leads da prospecção standalone (Prospeccao BR USA-Canada/crm.py +
crm.csv) para a tabela `leads` do Supabase do CRM da agência.

Uso:
    python3 scripts/import_prospeccao_csv.py [caminho_do_csv]

Se o caminho não for informado, usa por padrão:
    ../Prospeccao BR USA-Canada/crm.csv (relativo à raiz deste projeto)

Idempotente: usa a coluna "chave" do CSV (normalmente a URL do Google Maps
do lead) como `external_key` e faz upsert com onConflict=external_key, então
rodar o script várias vezes não duplica leads — só atualiza os já existentes.

Credenciais: lê SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY do arquivo
.env.local na raiz do projeto (mesmo padrão do scripts/import_leads_csv.py
do crm-leads da Evellyn), ou das variáveis de ambiente já exportadas no
shell, o que estiver disponível primeiro. NÃO execute este script sem
credenciais reais de um projeto Supabase configurado — ele não faz nada
sozinho, só documenta como a importação deve ser feita.
"""
import csv
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

# Mapa de status em português (crm.py / crm.csv) -> enum snake_case usado na
# tabela public.leads (ver lib/types.ts e supabase/schema.sql). O enum do CRM
# foi trocado para espelhar as colunas do board Trello de prospecção, que não
# correspondem 1:1 aos estágios antigos do crm.py — o mapeamento abaixo é uma
# aproximação de melhor esforço (ex: "demo enviada" não é semanticamente o
# mesmo que "terceiro_contato", mas é o estágio mais próximo na posição do
# funil).
STATUS_MAP = {
    "novo": "novo_lead",
    "contatado": "primeiro_contato",
    "respondeu": "segundo_contato",
    "demo enviada": "terceiro_contato",
    "negociando": "reuniao_marcada",
    "cliente ativo": "contrato_assinado",
    "perdido": "finalizado",
    "cancelado": "desqualificado",
}

DEFAULT_CSV_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "..",
    "Prospeccao BR USA-Canada",
    "crm.csv",
)


def load_env(path):
    """Lê pares KEY=VALUE de um arquivo .env.local simples (sem suporte a
    aspas complexas ou interpolação — só o suficiente pro que usamos aqui)."""
    env = {}
    if not os.path.exists(path):
        return env
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            value = value.strip().strip('"')
            env[key.strip()] = value
    return env


def map_status(raw_status):
    """Converte o rótulo em português do crm.csv pro enum do banco. Cai em
    'novo_lead' se vier algo inesperado/vazio, pra nunca falhar a importação
    por causa de uma única linha com status estranho."""
    key = (raw_status or "").strip().lower()
    return STATUS_MAP.get(key, "novo_lead")


def parse_monthly_value(raw_value):
    if not raw_value or not raw_value.strip():
        return None
    cleaned = raw_value.strip().replace("R$", "").replace(".", "").replace(",", ".").strip()
    try:
        return float(cleaned)
    except ValueError:
        return None


def parse_next_followup(raw_date):
    """Espera yyyy-mm-dd (formato usado pelo crm.py). Ignora silenciosamente
    se vier em outro formato, pra não travar a importação inteira."""
    raw_date = (raw_date or "").strip()
    if not raw_date:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(raw_date, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def parse_updated_at(raw_datetime):
    """Formato do crm.py: 'yyyy-mm-dd HH:MM' (horário local, assumido
    America/Sao_Paulo -03:00, mesmo fuso da agência)."""
    raw_datetime = (raw_datetime or "").strip()
    if not raw_datetime:
        return None
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S"):
        try:
            dt = datetime.strptime(raw_datetime, fmt)
            dt = dt.replace(tzinfo=timezone(timedelta(hours=-3)))
            return dt.isoformat()
        except ValueError:
            continue
    return None


def build_lead_row(row):
    updated_at = parse_updated_at(row.get("atualizado_em"))
    notes_parts = []
    if row.get("notas", "").strip():
        notes_parts.append(row["notas"].strip())
    if row.get("link_demo", "").strip():
        notes_parts.append(f"Demo: {row['link_demo'].strip()}")
    notes = "\n".join(notes_parts) or None

    return {
        "external_key": row.get("chave", "").strip() or None,
        "full_name": row.get("nome", "").strip() or None,
        "phone": row.get("telefone", "").strip() or None,
        "city": row.get("cidade", "").strip() or None,
        "category": row.get("categoria", "").strip() or None,
        "status": map_status(row.get("status")),
        "source": "prospeccao",
        "monthly_value": parse_monthly_value(row.get("valor_mensal")),
        "next_followup": parse_next_followup(row.get("proximo_followup")),
        "notes": notes,
        # created_at fica com o default now() do banco na primeira inserção;
        # updated_at é sobrescrito pelo trigger set_updated_at() a cada
        # upsert, então não enviamos esses dois campos explicitamente — só
        # guardamos a data original do crm.csv dentro das notas/raw_payload
        # abaixo, pra não perder a informação.
        "raw_payload": {
            "_origem": "Importado via scripts/import_prospeccao_csv.py a partir de "
            "Prospeccao BR USA-Canada/crm.csv (pipeline standalone crm.py).",
            "atualizado_em_original": row.get("atualizado_em") or None,
            "csv_row": row,
        },
    }


def main():
    csv_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_CSV_PATH
    csv_path = os.path.abspath(csv_path)

    if not os.path.exists(csv_path):
        print(f"Arquivo não encontrado: {csv_path}")
        sys.exit(1)

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

    rows_to_import = []
    skipped_no_key = 0

    with open(csv_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if not (row.get("chave") or "").strip():
                # Sem external_key não dá pra fazer upsert idempotente com
                # segurança — pula em vez de arriscar duplicar em reruns.
                skipped_no_key += 1
                continue
            rows_to_import.append(build_lead_row(row))

    print(f"Linhas no CSV: {skipped_no_key + len(rows_to_import)}")
    print(f"Puladas por falta de 'chave': {skipped_no_key}")
    print(f"Leads a importar/atualizar: {len(rows_to_import)}")

    if not rows_to_import:
        print("Nada para importar.")
        return

    body = json.dumps(rows_to_import).encode("utf-8")
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
