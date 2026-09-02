import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isValidSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { whatsappChannelForSource } from "@/lib/whatsapp-templates";
import {
  Lead,
  STATUS_LABELS,
  STATUS_ORDER,
  PROPOSAL_STATUS_ALL,
  PROPOSAL_STATUS_LABELS,
  ProposalStatus,
} from "@/lib/types";
import MonthFilter from "./MonthFilter";

/** Formato aceito no parâmetro `?mes=` da URL (ano-mês, igual ao input nativo
 * `type="month"`). */
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/** Desloca uma string "YYYY-MM" em `delta` meses (positivo ou negativo). */
function shiftMonth(month: string, delta: number): string {
  const [year, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, m - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string): string {
  const label = new Date(`${month}-01T12:00:00Z`).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function Bar({
  label,
  count,
  total,
  color,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="text-neutral-700">{label}</span>
        <span className="text-neutral-500">
          {count} <span className="text-neutral-400">({pct}%)</span>
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  novo_lead: "bg-blue-500",
  primeiro_contato: "bg-sky-500",
  segundo_contato: "bg-cyan-500",
  terceiro_contato: "bg-purple-500",
  reuniao_marcada: "bg-amber-500",
  no_show: "bg-orange-600",
  diagnostico_enviado: "bg-indigo-500",
  contrato_assinado: "bg-emerald-500",
  retornar_depois: "bg-teal-600",
  finalizado: "bg-red-500",
  desqualificado: "bg-neutral-400",
};

const PROPOSAL_STATUS_COLORS: Record<ProposalStatus, string> = {
  rascunho: "bg-neutral-400",
  enviada: "bg-blue-500",
  em_negociacao: "bg-amber-500",
  aceita: "bg-emerald-500",
  recusada: "bg-red-500",
  expirada: "bg-neutral-300",
};

export default async function MetricasPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!isValidSessionToken(token)) {
    redirect("/login");
  }

  const mesParam = (await searchParams).mes;
  const selectedMonth = mesParam && MONTH_RE.test(mesParam) ? mesParam : currentMonth();
  const previousMonth = shiftMonth(selectedMonth, -1);

  const supabase = createServiceClient();
  const [{ data: leadsData }, { data: clientsData }, { data: proposalsData }] = await Promise.all([
    supabase
      .from("leads")
      .select("status, source, created_at")
      .is("merged_into_lead_id", null),
    supabase.from("clients").select("status, monthly_value"),
    supabase.from("proposals").select("status, value"),
  ]);

  const leads = (leadsData as Pick<Lead, "status" | "source" | "created_at">[]) ?? [];
  const clients = clientsData ?? [];
  const proposals = proposalsData ?? [];

  const total = leads.length;
  const byStatus = STATUS_ORDER.map((status) => ({
    status,
    count: leads.filter((l) => l.status === status).length,
  }));

  // Taxa de conversão: dos leads que já tiveram um desfecho "vivo" (exclui
  // finalizado/desqualificado), quantos viraram contrato assinado.
  const decidedLeads = leads.filter((l) => l.status !== "finalizado" && l.status !== "desqualificado");
  const contratoAssinadoLeads = leads.filter((l) => l.status === "contrato_assinado");
  const conversionRate =
    decidedLeads.length > 0 ? Math.round((contratoAssinadoLeads.length / decidedLeads.length) * 100) : 0;

  // Tráfego pago por mês: leads de Meta Ads/Trello (mesmo critério de
  // lib/whatsapp-templates.ts:whatsappChannelForSource), filtrados pelo mês
  // selecionado no seletor (?mes=YYYY-MM), pra responder "como foi o
  // desempenho da campanha em tal mês" sem precisar abrir o Kanban inteiro.
  const paidLeads = leads.filter((l) => whatsappChannelForSource(l.source) === "pago");
  const paidLeadsInMonth = paidLeads.filter((l) => l.created_at.slice(0, 7) === selectedMonth);
  const paidLeadsInPreviousMonth = paidLeads.filter(
    (l) => l.created_at.slice(0, 7) === previousMonth
  );
  const totalPago = paidLeadsInMonth.length;
  const byStatusPago = STATUS_ORDER.map((status) => ({
    status,
    count: paidLeadsInMonth.filter((l) => l.status === status).length,
  }));
  const decidedLeadsPago = paidLeadsInMonth.filter(
    (l) => l.status !== "finalizado" && l.status !== "desqualificado"
  );
  const contratoAssinadoLeadsPago = paidLeadsInMonth.filter((l) => l.status === "contrato_assinado");
  const conversionRatePago =
    decidedLeadsPago.length > 0
      ? Math.round((contratoAssinadoLeadsPago.length / decidedLeadsPago.length) * 100)
      : 0;

  const mrr = clients
    .filter((c) => c.status === "ativo")
    .reduce((sum, c) => sum + (c.monthly_value ?? 0), 0);

  const activeClientsCount = clients.filter((c) => c.status === "ativo").length;

  const proposalsByStatus = PROPOSAL_STATUS_ALL.map((status) => ({
    status,
    count: proposals.filter((p) => p.status === status).length,
    value: proposals
      .filter((p) => p.status === status)
      .reduce((sum, p) => sum + (p.value ?? 0), 0),
  }));
  const totalProposals = proposals.length;

  const now = Date.now();
  const last7d = leads.filter(
    (l) => now - new Date(l.created_at).getTime() <= 7 * 24 * 60 * 60 * 1000
  ).length;
  const last30d = leads.filter(
    (l) => now - new Date(l.created_at).getTime() <= 30 * 24 * 60 * 60 * 1000
  ).length;

  const formatCurrency = (value: number) =>
    value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <div className="min-h-screen bg-neutral-100">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <h1 className="font-serif text-2xl text-neutral-900">Métricas</h1>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <p className="text-xs uppercase tracking-wide text-neutral-500">Total de leads</p>
            <p className="mt-1 font-serif text-3xl text-neutral-900">{total}</p>
            <p className="text-[11px] text-neutral-400">
              {last7d} nos últimos 7d · {last30d} nos últimos 30d
            </p>
          </div>
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <p className="text-xs uppercase tracking-wide text-neutral-500">Taxa de conversão</p>
            <p className="mt-1 font-serif text-3xl text-neutral-900">{conversionRate}%</p>
            <p className="text-[11px] text-neutral-400">contrato assinado / (total − finalizado − desqualificado)</p>
          </div>
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <p className="text-xs uppercase tracking-wide text-neutral-500">MRR (clientes ativos)</p>
            <p className="mt-1 font-serif text-3xl text-emerald-700">{formatCurrency(mrr)}</p>
            <p className="text-[11px] text-neutral-400">{activeClientsCount} cliente(s) ativo(s)</p>
          </div>
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <p className="text-xs uppercase tracking-wide text-neutral-500">Propostas em aberto</p>
            <p className="mt-1 font-serif text-3xl text-neutral-900">{totalProposals}</p>
            <p className="text-[11px] text-neutral-400">todas as fases</p>
          </div>
        </div>

        <div className="rounded-lg bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-serif text-lg text-neutral-900">Funil de leads</h2>
          <div className="space-y-3">
            {byStatus.map(({ status, count }) => (
              <Bar
                key={status}
                label={STATUS_LABELS[status]}
                count={count}
                total={total}
                color={STATUS_COLORS[status] ?? "bg-neutral-400"}
              />
            ))}
          </div>
        </div>

        <div className="rounded-lg bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-serif text-lg text-neutral-900">Tráfego pago por mês</h2>
              <p className="text-xs text-neutral-400">
                Leads de Meta Ads e Trello, filtrados pelo mês em que entraram no CRM
              </p>
            </div>
            <MonthFilter month={selectedMonth} />
          </div>

          <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-neutral-500">Leads no mês</p>
              <p className="mt-1 font-serif text-3xl text-neutral-900">{totalPago}</p>
              <p className="text-[11px] text-neutral-400">
                {paidLeadsInPreviousMonth.length} no mês anterior
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-neutral-500">Taxa de conversão</p>
              <p className="mt-1 font-serif text-3xl text-neutral-900">{conversionRatePago}%</p>
              <p className="text-[11px] text-neutral-400">contrato assinado / (total − finalizado − desqualificado)</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-neutral-500">Mês selecionado</p>
              <p className="mt-1 font-serif text-xl capitalize text-neutral-900">{monthLabel(selectedMonth)}</p>
            </div>
          </div>

          <div className="space-y-3">
            {byStatusPago.map(({ status, count }) => (
              <Bar
                key={status}
                label={STATUS_LABELS[status]}
                count={count}
                total={totalPago}
                color={STATUS_COLORS[status] ?? "bg-neutral-400"}
              />
            ))}
            {totalPago === 0 && (
              <p className="text-sm text-neutral-400">Nenhum lead de tráfego pago nesse mês.</p>
            )}
          </div>
        </div>

        <div className="rounded-lg bg-white p-5 shadow-sm">
          <h2 className="mb-1 font-serif text-lg text-neutral-900">Propostas por status</h2>
          <p className="mb-4 text-xs text-neutral-400">Contagem e valor somado por fase</p>
          <div className="space-y-3">
            {proposalsByStatus.map(({ status, count, value }) => (
              <div key={status}>
                <Bar
                  label={PROPOSAL_STATUS_LABELS[status]}
                  count={count}
                  total={totalProposals}
                  color={PROPOSAL_STATUS_COLORS[status]}
                />
                {value > 0 && (
                  <p className="mt-0.5 text-[11px] text-neutral-400">{formatCurrency(value)}</p>
                )}
              </div>
            ))}
            {totalProposals === 0 && (
              <p className="text-sm text-neutral-400">Sem propostas cadastradas ainda.</p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
