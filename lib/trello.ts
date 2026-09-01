import { LeadStatus } from "@/lib/types";

/**
 * Sincronização CRM -> Trello: quando o status de um lead é alterado dentro
 * do próprio CRM (dropdown do modal de detalhe, drag-and-drop no Kanban, ou
 * a conversão automática pra "contrato_assinado"), move o card
 * correspondente no board do Trello pra lista equivalente — completando o
 * caminho inverso do que já existe em app/api/webhook/trello/route.ts
 * (Trello -> CRM).
 *
 * Só se aplica a leads cujo external_key indica que vieram do Trello
 * (`trello:<id do card>` — mesma convenção usada no webhook e em
 * scripts/import_trello_leads.py). Leads de outras origens (Meta Ads,
 * manual, prospecção) não têm card correspondente, então a função é um
 * no-op nesses casos.
 *
 * Mesmo mapa de nome de lista -> status usado em
 * app/api/webhook/trello/route.ts e scripts/import_trello_leads.py.
 * "contrato_assinado" é propositalmente exclusivo do CRM (não existe lista
 * correspondente no Trello — ver docstring de import_trello_leads.py), então
 * nesse caso a função não encontra lista alvo e não faz nada (não é erro).
 */
const LIST_NAME_TO_STATUS: Record<string, LeadStatus> = {
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
  finalizado: "finalizado",
  desqualificado: "desqualificado",
};

interface TrelloListRef {
  id: string;
  name: string;
}

export interface TrelloSyncResult {
  ok: boolean;
  /** Motivo de não ter feito nada (não é uma falha). */
  skipped?: string;
  error?: string;
}

/**
 * Move o card do Trello vinculado a `externalKey` pra lista que corresponde
 * a `status`, se existir. Nunca lança exceção — sempre retorna
 * `{ ok, skipped? , error? }`, seguindo o mesmo contrato de
 * lib/whatsapp-automation.ts, porque é chamada de dentro de uma rota de API
 * que não pode quebrar por causa de uma falha numa integração externa.
 */
export async function syncLeadStatusToTrello(
  externalKey: string | null | undefined,
  status: LeadStatus
): Promise<TrelloSyncResult> {
  try {
    if (!externalKey || !externalKey.startsWith("trello:")) {
      return { ok: true, skipped: "lead não veio do Trello" };
    }

    const key = process.env.TRELLO_API_KEY;
    const token = process.env.TRELLO_TOKEN;
    if (!key || !token) {
      console.warn(
        "Sync CRM->Trello: TRELLO_API_KEY/TRELLO_TOKEN não configurados — card não foi movido."
      );
      return { ok: false, error: "credenciais do Trello não configuradas" };
    }

    const cardId = externalKey.slice("trello:".length);

    const cardRes = await fetch(
      `https://api.trello.com/1/cards/${cardId}?key=${key}&token=${token}&fields=idBoard,idList`
    );
    if (!cardRes.ok) {
      return { ok: false, error: `falha ao buscar card no Trello (HTTP ${cardRes.status})` };
    }
    const card = (await cardRes.json()) as { idBoard?: string; idList?: string };
    if (!card.idBoard) {
      return { ok: false, error: "card sem idBoard retornado pela API do Trello" };
    }

    const listsRes = await fetch(
      `https://api.trello.com/1/boards/${card.idBoard}/lists?key=${key}&token=${token}&fields=id,name`
    );
    if (!listsRes.ok) {
      return { ok: false, error: `falha ao buscar listas do board (HTTP ${listsRes.status})` };
    }
    const lists = (await listsRes.json()) as TrelloListRef[];

    const targetList = lists.find(
      (l) => LIST_NAME_TO_STATUS[l.name.trim().toLowerCase()] === status
    );

    if (!targetList) {
      return { ok: true, skipped: `status "${status}" não tem lista correspondente no Trello` };
    }

    if (targetList.id === card.idList) {
      return { ok: true, skipped: "card já está na lista correta" };
    }

    const moveRes = await fetch(
      `https://api.trello.com/1/cards/${cardId}?key=${key}&token=${token}&idList=${targetList.id}`,
      { method: "PUT" }
    );
    if (!moveRes.ok) {
      return { ok: false, error: `falha ao mover card no Trello (HTTP ${moveRes.status})` };
    }

    return { ok: true };
  } catch (err) {
    console.error("Erro inesperado ao sincronizar status do lead com o Trello:", err);
    return { ok: false, error: err instanceof Error ? err.message : "erro desconhecido" };
  }
}
