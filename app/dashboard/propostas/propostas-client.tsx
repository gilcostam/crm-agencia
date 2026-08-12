"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Client,
  Lead,
  Proposal,
  ProposalStatus,
  PROPOSAL_STATUS_ALL,
  PROPOSAL_STATUS_LABELS,
} from "@/lib/types";
import PropostaModal, { ProposalFormValues } from "../_components/PropostaModal";

function formatDate(iso: string | null) {
  if (!iso) return null;
  return new Date(`${iso}T00:00:00`).toLocaleDateString("pt-BR");
}

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const STATUS_COLORS: Record<ProposalStatus, string> = {
  rascunho: "border-neutral-200",
  enviada: "border-blue-200",
  em_negociacao: "border-amber-200",
  aceita: "border-emerald-200",
  recusada: "border-red-200",
  expirada: "border-neutral-200",
};

export default function PropostasClient({
  initialProposals,
  initialClients,
  initialLeads,
}: {
  initialProposals: Proposal[];
  initialClients: Client[];
  initialLeads: Lead[];
}) {
  const [proposals, setProposals] = useState<Proposal[]>(initialProposals);
  const [clients] = useState<Client[]>(initialClients);
  const [leads] = useState<Lead[]>(initialLeads);
  const [search, setSearch] = useState("");
  const [dragOverStatus, setDragOverStatus] = useState<ProposalStatus | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [defaultClientId, setDefaultClientId] = useState<string | undefined>(undefined);
  const [editingProposal, setEditingProposal] = useState<Proposal | null>(null);

  useEffect(() => {
    const clienteParam = new URLSearchParams(window.location.search).get("cliente");
    if (clienteParam) {
      setDefaultClientId(clienteParam);
      setShowNewModal(true);
    }
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return proposals;
    return proposals.filter((p) =>
      [p.title, p.client?.full_name, p.service_type]
        .filter(Boolean)
        .some((field) => (field as string).toLowerCase().includes(q))
    );
  }, [proposals, search]);

  function toApiPayload(values: ProposalFormValues) {
    return {
      client_id: values.client_id || null,
      lead_id: values.lead_id || null,
      title: values.title,
      status: values.status,
      service_type: values.service_type,
      value: values.value,
      recurring: values.recurring,
      sent_at: values.sent_at || null,
      valid_until: values.valid_until || null,
      contract_signed_at: values.contract_signed_at || null,
      contract_file_url: values.contract_file_url,
      notes: values.notes,
    };
  }

  async function handleCreate(values: ProposalFormValues): Promise<string | null> {
    const res = await fetch("/api/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toApiPayload(values)),
    });
    const data = await res.json();
    if (!res.ok) return data.error ?? "Erro ao cadastrar proposta";
    setProposals((prev) => [data.proposal, ...prev]);
    return null;
  }

  async function handleUpdate(
    id: string,
    values: Partial<ProposalFormValues> | { status: ProposalStatus }
  ): Promise<string | null> {
    const payload =
      "title" in values ? toApiPayload(values as ProposalFormValues) : { status: values.status };
    const res = await fetch(`/api/proposals/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) return data.error ?? "Erro ao salvar proposta";
    setProposals((prev) => prev.map((p) => (p.id === id ? data.proposal : p)));
    return null;
  }

  async function updateStatus(id: string, status: ProposalStatus) {
    const prevProposals = proposals;
    setProposals((prev) => prev.map((p) => (p.id === id ? { ...p, status } : p)));
    const errMsg = await handleUpdate(id, { status });
    if (errMsg) setProposals(prevProposals);
  }

  return (
    <div className="min-h-screen bg-neutral-100">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <h1 className="font-serif text-2xl text-neutral-900">Propostas</h1>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <input
            type="text"
            placeholder="Buscar por título, cliente, serviço..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full max-w-sm rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700"
          />
          <button
            onClick={() => {
              setDefaultClientId(undefined);
              setShowNewModal(true);
            }}
            className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-700"
          >
            + Nova proposta
          </button>
          {search && (
            <span className="text-xs text-neutral-400">
              {filtered.length} de {proposals.length} propostas
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {PROPOSAL_STATUS_ALL.map((status) => {
            const columnProposals = filtered.filter((p) => p.status === status);
            const columnValue = columnProposals.reduce((sum, p) => sum + (p.value ?? 0), 0);
            return (
              <div
                key={status}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDragOverStatus(status);
                }}
                onDragLeave={() => setDragOverStatus((s) => (s === status ? null : s))}
                onDrop={(e) => {
                  e.preventDefault();
                  const proposalId = e.dataTransfer.getData("text/plain");
                  if (proposalId) updateStatus(proposalId, status);
                  setDragOverStatus(null);
                }}
                className={`rounded-lg bg-white p-3 shadow-sm transition ${
                  dragOverStatus === status ? "ring-2 ring-neutral-900" : ""
                }`}
              >
                <div className="mb-3 flex items-center justify-between px-1">
                  <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                    {PROPOSAL_STATUS_LABELS[status]}
                  </h2>
                  <span className="text-xs text-neutral-400">{columnProposals.length}</span>
                </div>
                {columnValue > 0 && (
                  <p className="mb-2 px-1 text-[11px] font-medium text-emerald-700">
                    {formatCurrency(columnValue)}
                  </p>
                )}

                <div className="space-y-2">
                  {columnProposals.length === 0 && (
                    <p className="px-1 py-6 text-center text-xs text-neutral-400">
                      Sem propostas
                    </p>
                  )}

                  {columnProposals.map((p) => {
                    const sentAt = formatDate(p.sent_at);
                    const validUntil = formatDate(p.valid_until);
                    return (
                      <div
                        key={p.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", p.id);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onClick={() => setEditingProposal(p)}
                        className={`cursor-grab rounded-md border bg-neutral-50 p-3 transition hover:bg-neutral-100 active:cursor-grabbing ${STATUS_COLORS[status]}`}
                      >
                        <p className="text-sm font-medium text-neutral-900">{p.title}</p>
                        {p.client?.full_name && (
                          <p className="text-xs text-neutral-500">{p.client.full_name}</p>
                        )}
                        {p.service_type && (
                          <p className="text-[10px] uppercase tracking-wide text-neutral-400">
                            {p.service_type}
                          </p>
                        )}
                        {p.value !== null && (
                          <p className="text-xs font-medium text-emerald-700">
                            {formatCurrency(p.value)}
                            {p.recurring ? "/mês" : ""}
                          </p>
                        )}
                        <div className="mt-1 flex flex-wrap gap-1">
                          {p.recurring && (
                            <span className="inline-block rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">
                              Recorrente
                            </span>
                          )}
                          {sentAt && (
                            <span className="inline-block rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                              Enviada {sentAt}
                            </span>
                          )}
                          {validUntil && (
                            <span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                              Válida até {validUntil}
                            </span>
                          )}
                        </div>

                        <select
                          value={p.status}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => updateStatus(p.id, e.target.value as ProposalStatus)}
                          className="mt-2 w-full rounded border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-700"
                        >
                          {PROPOSAL_STATUS_ALL.map((s) => (
                            <option key={s} value={s}>
                              {PROPOSAL_STATUS_LABELS[s]}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </main>

      {showNewModal && (
        <PropostaModal
          clients={clients}
          leads={leads}
          defaultClientId={defaultClientId}
          onClose={() => setShowNewModal(false)}
          onSave={handleCreate}
        />
      )}

      {editingProposal && (
        <PropostaModal
          initial={editingProposal}
          clients={clients}
          leads={leads}
          onClose={() => setEditingProposal(null)}
          onSave={(values) => handleUpdate(editingProposal.id, values)}
        />
      )}
    </div>
  );
}
