#!/usr/bin/env python3
"""
Importa uma lista de empresas exportada do TNG Pesquisa (pesquisa.tngdigital.com.br,
aba "Maps" -> botão "baixar CSV") pra tabela `leads` do Supabase do CRM da agência,
como leads de prospecção ativa (outbound) — separados do tráfego pago (Meta Ads)
pelo campo `source`.

O TNG Pesquisa não tem webhook/API pra empurrar dados automaticamente pro CRM (só
exportação manual de CSV e um backup geral de conta em JSON — confirmado inspecionando
a própria aba "Conta" da ferramenta). Este script é o caminho de integração possível
hoje: alguém baixa o CSV de uma busca (por nicho + cidade) na aba Maps e roda este
script apontando pro arquivo.

Uso:
    python3 scripts/import_tng_leads.py caminho/para/lista.csv

Formato esperado do CSV (delimitador ';', com BOM utf-8-sig — é exatamente o que o
botão "baixar CSV" do TNG Pesquisa gera, não precisa converter nada):
    posição;pontos;faixa;empresa;categoria;endereço;telefone;celular;site;
    situação do site;nota;avaliações;perfil verificado

Dedupe/idempotência: o CSV do TNG não traz nenhum ID estável (nem URL do Google
Maps, nem place_id) — só o telefone é único o bastante pra servir de chave. Por
isso `external_key = "tng:<telefone só dígitos>"`. Duas buscas diferentes que
trazem a mesma empresa (comum: "cardiologista" e "médico" na mesma cidade) vão
colidir na mesma external_key e o upsert só atualiza o lead existente, sem
duplicar. Linhas sem telefone são puladas (sem telefone não dá pra abordar por
WhatsApp, que é o objetivo desses leads).

Credenciais: mesmas de scripts/import_prospeccao_csv.py e
scripts/import_trello_leads.py — lidas de .env.local na raiz do projeto
(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY), ou de variáveis de ambiente.
"""
import csv
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


# Endereço vem como "R. Ceará, 1048 - Centro, Catanduva - SP, 15800-003" —
# a cidade é o trecho logo antes de " - <UF>, <CEP>". Se o padrão não bater
# (endereço em outro formato, ou vazio), simplesmente não preenche `city` —
# não é informação crítica pra esse tipo de lead.
CITY_RE = re.compile(r",\s*([^,]+?)\s*-\s*[A-Z]{2},?\s*\d{5}-?\d{3}")


def parse_city(address):
    if not address:
        return None
    m = CITY_RE.search(address)
    return m.group(1).strip() if m else None


def only_digits(value):
    return re.sub(r"\D", "", value or "")


def build_lead_row(row):
    phone = (row.get("telefone") or "").strip()
    phone_digits = only_digits(phone)

    score = (row.get("pontos") or "").strip()
    faixa = (row.get("faixa") or "").strip()
    site_status = (row.get("situação do site") or "").strip()
    rating = (row.get("nota") or "").strip()
    reviews = (row.get("avaliações") or "").strip()
    verified = (row.get("perfil verificado") or "").strip().lower() == "sim"
    address = (row.get("endereço") or "").strip()

    notes_parts = [
        f"Prospecção TNG — oportunidade {score or '?'} pts ({faixa or 'sem faixa'})",
        f"Site: {site_status or 'desconhecido'}",
    ]
    if rating:
        notes_parts.append(f"Avaliação Google: {rating} ({reviews or '0'} avaliações)")
    notes_parts.append(f"Perfil verificado no Maps: {'sim' if verified else 'não'}")
    if address:
        notes_parts.append(f"Endereço: {address}")

    return {
        "external_key": f"tng:{phone_digits}" if phone_digits else None,
        "full_name": (row.get("empresa") or "").strip() or None,
        "phone": phone or None,
        "city": parse_city(address),
        "category": (row.get("categoria") or "").strip() or None,
        "status": "novo_lead",
        "source": "tng_prospeccao",
        "notes": "\n".join(notes_parts),
        "raw_payload": {
            "_origem": "Importado via scripts/import_tng_leads.py a partir de um CSV "
            "exportado da aba Maps do TNG Pesquisa (pesquisa.tngdigital.com.br).",
            "csv_row": row,
        },
    }


def dedupe_by_external_key(rows):
    """O upsert do Supabase (`ON CONFLICT DO UPDATE`) rejeita a request inteira se
    duas linhas do mesmo POST tiverem a mesma `external_key` ("cannot affect row a
    second time"). Isso acontece de verdade no CSV do TNG: várias empresas na mesma
    busca compartilham o mesmo telefone (ex.: consultórios de um mesmo prédio/clínica
    usando a recepção como número de contato) — não é erro de digitação.

    Aqui, resolvemos agrupando por `external_key` e mantendo uma linha por grupo (a
    de maior pontuação "pontos", como proxy de relevância), sem perder as demais: os
    outros nomes de empresa do grupo são anexados às notas do lead escolhido.
    """
    groups = {}
    order = []
    for row in rows:
        key = row["external_key"]
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(row)

    deduped = []
    for key in order:
        group = groups[key]
        if len(group) == 1:
            deduped.append(group[0])
            continue

        def score(r):
            try:
                return float(r["raw_payload"]["csv_row"].get("pontos") or 0)
            except (TypeError, ValueError):
                return 0.0

        group.sort(key=score, reverse=True)
        primary = group[0]
        others = [r["full_name"] for r in group[1:] if r["full_name"]]
        if others:
            primary["notes"] += (
                "\nTelefone compartilhado no Maps com: " + "; ".join(others)
            )
        deduped.append(primary)
    return deduped


def main():
    if len(sys.argv) < 2:
        print("Uso: python3 scripts/import_tng_leads.py caminho/para/lista.csv")
        sys.exit(1)

    csv_path = os.path.abspath(sys.argv[1])
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
    skipped_no_phone = 0

    with open(csv_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f, delimiter=";")
        for row in reader:
            lead_row = build_lead_row(row)
            if not lead_row["external_key"]:
                skipped_no_phone += 1
                continue
            rows_to_import.append(lead_row)

    before_dedupe = len(rows_to_import)
    rows_to_import = dedupe_by_external_key(rows_to_import)
    merged_count = before_dedupe - len(rows_to_import)

    print(f"Linhas no CSV: {skipped_no_phone + before_dedupe}")
    print(f"Puladas por falta de telefone: {skipped_no_phone}")
    if merged_count:
        print(
            f"Agrupadas por telefone compartilhado (mesma empresa/prédio): {merged_count}"
        )
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
