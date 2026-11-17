"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DIAS_PARA_SAIR_DA_FILA,
  ItemFila,
  MOTIVO_LABELS,
  MOTIVO_POR_QUE,
  MotivoFila,
  montarFilaDoDia,
} from "@/lib/fila-do-dia";
import { FOLLOWUP_INTERVAL_HOURS } from "@/lib/lead-status";
import { Lead, STATUS_LABELS } from "@/lib/types";
import WhatsAppComposerModal from "../_components/WhatsAppComposerModal";

/** Cores por motivo. Só três níveis de propósito: vermelho pro que tem hora
 * marcada e não volta, âmbar pro que está esfriando, e neutro pro estoque.
 * Mais cores que isso e a ordem deixa de ser legível de relance. */
const MOTIVO_TOM: Record<MotivoFila, string> = {
  reuniao_hoje_sem_confirmacao: "border-red-300 bg-red-50 text-red-900",
  reuniao_proxima_sem_confirmacao: "border-amber-300 bg-amber-50 text-amber-900",
  diagnostico_parado: "border-amber-300 bg-amber-50 text-amber-900",
  no_show_sem_resgate: "border-amber-300 bg-amber-50 text-amber-900",
  followup_vencido: "border-amber-300 bg-amber-50 text-amber-900",
  followup_hoje: "border-neutral-300 bg-neutral-50 text-neutral-800",
  inbound_sem_contato: "border-neutral-300 bg-neutral-50 text-neutral-800",
};

/** Quantos itens a fila mostra antes de cortar. Não é um limite técnico: é o
 * ponto todo. Uma lista de 150 nomes é o mesmo quadro de sempre com outro
 * formato, e volta a não dizer por onde começar. O resto continua no Kanban. */
const TETO_DA_FILA = 20;

export default function FilaClient({
  leads,
  confirmacoes,
}: {
  leads: Lead[];
  confirmacoes: Record<string, string>;
}) {
  const router = useRouter();
  const [composerLeadId, setComposerLeadId] = useState<string | null>(null);
  const [marcando, setMarcando] = useState<string | null>(null);

  /* "agora" só depois de montar: a fila depende do relógio local, e calcular
     isso durante o render do servidor daria uma marcação diferente da do
     navegador (e um aviso de hidratação). Até lá a tela mostra o esqueleto. */
  const [agora, setAgora] = useState<Date | null>(null);
  useEffect(() => {
    setAgora(new Date());
    /* Reavalia de hora em hora: uma reunião que estava "em 3 horas" vira
       "em menos de uma hora" sem precisar recarregar a página. */
    const t = setInterval(() => setAgora(new Date()), 3_600_000);
    return () => clearInterval(t);
  }, []);

  const { fila, parados } = useMemo(
    () =>
      agora
        ? montarFilaDoDia(leads, confirmacoes, agora)
        : { fila: [] as ItemFila[], parados: [] as ItemFila[] },
    [leads, confirmacoes, agora]
  );

  const visiveis = fila.slice(0, TETO_DA_FILA);
  const restantes = fila.length - visiveis.length;

  const composerLead = leads.find((l) => l.id === composerLeadId) ?? null;

  /** "Já falei com ele": adia o retorno em 48h, o mesmo intervalo combinado
   * da cadência, e o item sai da fila. Pra um lead inbound que ainda estava
   * em "Novo Lead", avança o status pro primeiro contato — aí o próprio
   * backend agenda o retorno (ver buildStatusChangeUpdate em
   * lib/lead-status.ts) e o lead passa a ter história de funil, em vez de
   * pular de "Novo Lead" direto pro meio da cadência. */
  async function marcarComoFalado(item: ItemFila) {
    setMarcando(item.lead.id);
    try {
      const body =
        item.motivo === "inbound_sem_contato"
          ? { status: "primeiro_contato" }
          : { next_followup: proximoFollowupISO() };
      await fetch(`/api/leads/${item.lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      router.refresh();
    } finally {
      setMarcando(null);
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <main className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-8">
        <header className="mb-6">
          <h1 className="text-xl font-semibold text-neutral-900">Fila do dia</h1>
          <p className="mt-1 text-sm text-neutral-600">
            {agora === null
              ? "Montando a fila..."
              : fila.length === 0
                ? "Nada pendente pra hoje."
                : `${fila.length} ${fila.length === 1 ? "lead precisa" : "leads precisam"} de você hoje, em ordem. Comece de cima.`}
          </p>
        </header>

        {agora !== null && fila.length === 0 && (
          <div className="rounded-lg border border-neutral-200 bg-white p-6 text-center">
            <p className="text-sm font-medium text-neutral-900">
              Nenhuma reunião sem confirmação, nenhum follow-up vencido dentro do prazo
              de resgate e nenhum lead inbound esperando.
            </p>
            <p className="mt-2 text-sm text-neutral-500">
              Quando um lead vencer o prazo ou uma reunião for marcada sem confirmação,
              ele aparece aqui.
            </p>
          </div>
        )}

        <ol className="space-y-2.5">
          {visiveis.map((item, i) => {
            const ehReuniao =
              item.motivo === "reuniao_hoje_sem_confirmacao" ||
              item.motivo === "reuniao_proxima_sem_confirmacao";
            const primeiroDoMotivo = i === 0 || visiveis[i - 1].motivo !== item.motivo;

            return (
              <li key={item.lead.id}>
                {/* O "por quê" aparece uma vez por bloco, não em cada card:
                    é a explicação da ordem, e repetida em 20 linhas viraria
                    ruído. */}
                {primeiroDoMotivo && (
                  <div className="mb-2 mt-5 first:mt-0">
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      {MOTIVO_LABELS[item.motivo]}
                    </h2>
                    <p className="mt-1 text-xs leading-relaxed text-neutral-500">
                      {MOTIVO_POR_QUE[item.motivo]}
                    </p>
                  </div>
                )}

                <div
                  className={`flex items-start gap-3 rounded-lg border bg-white p-3.5 ${
                    item.motivo === "reuniao_hoje_sem_confirmacao"
                      ? "border-red-200"
                      : "border-neutral-200"
                  }`}
                >
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-xs font-semibold text-white">
                    {i + 1}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-neutral-900">
                        {item.lead.full_name || "Lead sem nome"}
                      </span>
                      <span
                        className={`rounded border px-1.5 py-0.5 text-[11px] font-medium ${MOTIVO_TOM[item.motivo]}`}
                      >
                        {item.detalhe}
                      </span>
                    </div>

                    <p className="mt-1 text-xs text-neutral-500">
                      {STATUS_LABELS[item.lead.status]}
                      {item.lead.category ? ` · ${item.lead.category}` : ""}
                      {item.lead.city ? ` · ${item.lead.city}` : ""}
                    </p>

                    <div className="mt-2.5 flex flex-wrap gap-2">
                      <button
                        onClick={() => setComposerLeadId(item.lead.id)}
                        className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800"
                      >
                        {ehReuniao ? "Mandar a confirmação" : "Abrir conversa"}
                      </button>
                      {!ehReuniao && (
                        <button
                          onClick={() => marcarComoFalado(item)}
                          disabled={marcando === item.lead.id}
                          className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                        >
                          {marcando === item.lead.id ? "Salvando..." : "Já falei, adia 48h"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        {restantes > 0 && (
          <p className="mt-5 rounded-lg border border-neutral-200 bg-white p-3.5 text-xs leading-relaxed text-neutral-500">
            Mais {restantes} {restantes === 1 ? "lead está" : "leads estão"} na mesma
            situação, abaixo destes na ordem. A fila mostra {TETO_DA_FILA} por dia de
            propósito: uma lista que não termina volta a ser o quadro, e deixa de dizer
            por onde começar. Eles continuam no Kanban e sobem pra cá conforme estes
            saírem.
          </p>
        )}

        {/* Os parados não são tarefa do dia. Aparecem como um número e uma
            pergunta, porque é isso que eles são: uma decisão pendente. */}
        {parados.length > 0 && (
          <section className="mt-5 rounded-lg border border-neutral-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-neutral-900">
              {parados.length} {parados.length === 1 ? "lead parado" : "leads parados"} há
              mais de {DIAS_PARA_SAIR_DA_FILA} dias
            </h2>
            <p className="mt-1.5 text-xs leading-relaxed text-neutral-500">
              Ficam fora da fila de propósito. Um lead parado há dois meses não volta com
              a mensagem de hoje: ou entra num resgate em lote, com um motivo novo pra
              conversa, ou sai da base. Deixá-los na fila diária enterraria embaixo deles
              os leads que ainda dá pra salvar, que é o que o Kanban já fazia.
            </p>
            {/* Quebrado por motivo e não só contado: entre os parados pode
                haver leads de "Diagnóstico Enviado", que é o ponto mais perto
                da venda em todo o funil. Um número só esconderia isso. */}
            <ul className="mt-2.5 space-y-1">
              {Object.entries(
                parados.reduce<Record<string, number>>((acc, it) => {
                  acc[it.motivo] = (acc[it.motivo] ?? 0) + 1;
                  return acc;
                }, {})
              )
                .sort((a, b) => b[1] - a[1])
                .map(([motivo, n]) => (
                  <li key={motivo} className="text-xs text-neutral-600">
                    <span className="font-medium text-neutral-900">{n}</span>{" "}
                    {MOTIVO_LABELS[motivo as MotivoFila].toLowerCase()}
                  </li>
                ))}
            </ul>
            <p className="mt-2.5 text-xs text-neutral-500">
              O mais antigo está parado há{" "}
              {parados[parados.length - 1]?.diasDeAtraso ?? 0} dias.
            </p>
          </section>
        )}
      </main>

      {composerLead && (
        <WhatsAppComposerModal
          lead={composerLead}
          onClose={() => setComposerLeadId(null)}
          onLogged={() => router.refresh()}
        />
      )}
    </div>
  );
}

/** Data (yyyy-mm-dd) do próximo follow-up contando o intervalo combinado da
 * cadência a partir de hoje, no fuso local. Mesma conta de
 * buildStatusChangeUpdate, feita aqui porque este caminho não muda o status
 * do lead (e por isso não passa por lá). */
function proximoFollowupISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + FOLLOWUP_INTERVAL_HOURS / 24);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
