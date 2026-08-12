"use client";

import { useEffect, useState } from "react";
import {
  Client,
  Lead,
  Proposal,
  ProposalStatus,
  PROPOSAL_STATUS_ALL,
  PROPOSAL_STATUS_LABELS,
  SERVICE_TYPE_SUGGESTIONS,
} from "@/lib/types";

export interface ProposalFormValues {
  client_id: string;
  lead_id: string;
  title: string;
  status: ProposalStatus;
  service_type: string;
  value: string;
  recurring: boolean;
  sent_at: string;
  valid_until: string;
  contract_signed_at: string;
  contract_file_url: string;
  notes: string;
}

function emptyForm(clientId = ""): ProposalFormValues {
  return {
    client_id: clientId,
    lead_id: "",
    title: "",
    status: "rascunho",
    service_type: "",
    value: "",
    recurring: false,
    sent_at: "",
    valid_until: "",
    contract_signed_at: "",
    contract_file_url: "",
    notes: "",
  };
}

export default function PropostaModal({
  initial,
  clients,
  leads,
  defaultClientId,
  onClose,
  onSave,
}: {
  initial?: Proposal | null;
  clients: Client[];
  leads: Lead[];
  defaultClientId?: string;
  onClose: () => void;
  onSave: (values: ProposalFormValues) => Promise<string | null>;
}) {
  const [values, setValues] = useState<ProposalFormValues>(
    initial
      ? {
          client_id: initial.client_id ?? "",
          lead_id: initial.lead_id ?? "",
          title: initial.title,
          status: initial.status,
          service_type: initial.service_type ?? "",
          value: initial.value !== null ? String(initial.value) : "",
          recurring: initial.recurring,
          sent_at: initial.sent_at ?? "",
          valid_until: initial.valid_until ?? "",
          contract_signed_at: initial.contract_signed_at ?? "",
          contract_file_url: initial.contract_file_url ?? "",
          notes: initial.notes ?? "",
        }
      : emptyForm(defaultClientId)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function set<K extends keyof ProposalFormValues>(key: K, value: ProposalFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const errMsg = await onSave(values);
    setSaving(false);
    if (errMsg) {
      setError(errMsg);
    } else {
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <h3 className="font-serif text-xl text-neutral-900">
            {initial ? "Editar proposta" : "Nova proposta"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-lg leading-none text-neutral-400 hover:text-neutral-900"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
              Título *
            </label>
            <input
              type="text"
              value={values.title}
              onChange={(e) => set("title", e.target.value)}
              required
              autoFocus
              placeholder="Ex.: SEO Local + GEO — plano mensal"
              className="w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
                Cliente
              </label>
              <select
                value={values.client_id}
                onChange={(e) => set("client_id", e.target.value)}
                className="w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700"
              >
                <option value="">Nenhum (ainda é lead)</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
                Lead de origem
              </label>
              <select
                value={values.lead_id}
                onChange={(e) => set("lead_id", e.target.value)}
                className="w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700"
              >
                <option value="">Nenhum</option>
                {leads.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.full_name || "Sem nome"}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
                Tipo de serviço
              </label>
              <input
                type="text"
                list="service-type-suggestions"
                value={values.service_type}
                onChange={(e) => set("service_type", e.target.value)}
                className="w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700"
              />
              <datalist id="service-type-suggestions">
                {SERVICE_TYPE_SUGGESTIONS.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
                Status
              </label>
              <select
                value={values.status}
                onChange={(e) => set("status", e.target.value as ProposalStatus)}
                className="w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700"
              >
                {PROPOSAL_STATUS_ALL.map((s) => (
                  <option key={s} value={s}>
                    {PROPOSAL_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
                Valor
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="R$ 0,00"
                value={values.value}
                onChange={(e) => set("value", e.target.value)}
                className="w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700"
              />
            </div>
            <div className="flex items-end pb-1.5">
              <label className="flex items-center gap-2 text-sm text-neutral-700">
                <input
                  type="checkbox"
                  checked={values.recurring}
                  onChange={(e) => set("recurring", e.target.checked)}
                  className="h-4 w-4 rounded border-neutral-300"
                />
                Valor recorrente (mensal)
              </label>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
                Enviada em
              </label>
              <input
                type="date"
                value={values.sent_at}
                onChange={(e) => set("sent_at", e.target.value)}
                className="w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
                Válida até
              </label>
              <input
                type="date"
                value={values.valid_until}
                onChange={(e) => set("valid_until", e.target.value)}
                className="w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
                Contrato assinado em
              </label>
              <input
                type="date"
                value={values.contract_signed_at}
                onChange={(e) => set("contract_signed_at", e.target.value)}
                className="w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
              Link do contrato/proposta
            </label>
            <input
              type="text"
              placeholder="https://..."
              value={values.contract_file_url}
              onChange={(e) => set("contract_file_url", e.target.value)}
              className="w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
              Observações
            </label>
            <textarea
              value={values.notes}
              onChange={(e) => set("notes", e.target.value)}
              rows={3}
              className="w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700"
            />
          </div>
        </div>

        {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-neutral-900 px-4 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
          >
            {saving ? "Salvando..." : initial ? "Salvar alterações" : "Cadastrar proposta"}
          </button>
        </div>
      </form>
    </div>
  );
}
