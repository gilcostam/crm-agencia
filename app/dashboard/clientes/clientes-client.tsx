"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Client,
  CLIENT_STATUS_LABELS,
  ClientStatus,
  CONTRACT_WARNING_DAYS,
  contractUrgency,
  ContractUrgency,
  Proposal,
} from "@/lib/types";
import { sanitizePhone } from "@/lib/phone";
import ClientTasksPanel from "./ClientTasksPanel";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR");
}

/** Formata uma coluna "date" pura (yyyy-mm-dd) sem risco de "voltar um dia"
 * perto da meia-noite por causa de fuso-horário (mesmo cuidado usado em
 * ClientTasksPanel para due_date). */
function formatDateOnly(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("pt-BR");
}

function todayISODate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysUntil(iso: string, todayISO: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  const [ty, tm, td] = todayISO.split("-").map(Number);
  const end = new Date(y, m - 1, d);
  const today = new Date(ty, tm - 1, td);
  return Math.round((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

const CONTRACT_URGENCY_BADGE: Record<Exclude<ContractUrgency, "unknown">, string> = {
  expired: "bg-red-100 text-red-700",
  warning: "bg-amber-100 text-amber-700",
  ok: "bg-neutral-100 text-neutral-500",
};

function ContractBadge({ endDate, today }: { endDate: string | null; today: string }) {
  const urgency = contractUrgency(endDate, today);
  if (urgency === "unknown" || !endDate) return <span className="text-neutral-400">—</span>;
  const diff = daysUntil(endDate, today);
  let label: string;
  if (urgency === "expired") {
    label = diff === -1 ? "Vencido há 1 dia" : `Vencido há ${Math.abs(diff)} dias`;
  } else if (diff === 0) {
    label = "Vence hoje";
  } else if (diff === 1) {
    label = "Vence amanhã";
  } else {
    label = `Vence em ${diff} dias`;
  }
  return (
    <span className="inline-flex flex-col gap-0.5">
      <span className="text-neutral-500">{formatDateOnly(endDate)}</span>
      {urgency !== "ok" && (
        <span
          className={`w-fit rounded px-1.5 py-0.5 text-[10px] font-medium ${CONTRACT_URGENCY_BADGE[urgency]}`}
        >
          {label}
        </span>
      )}
    </span>
  );
}

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function whatsappUrl(phone: string | null): string | null {
  const digits = sanitizePhone(phone);
  if (!digits) return null;
  return `https://wa.me/${digits}`;
}

const STATUS_FILTERS: Array<"all" | ClientStatus> = ["all", "ativo", "pausado", "cancelado"];

interface ClientFormValues {
  full_name: string;
  email: string;
  phone: string;
  document: string;
  category: string;
  city: string;
  monthly_value: string;
  status: ClientStatus;
  notes: string;
  contract_start_date: string;
  contract_end_date: string;
}

const EMPTY_FORM: ClientFormValues = {
  full_name: "",
  email: "",
  phone: "",
  document: "",
  category: "",
  city: "",
  monthly_value: "",
  status: "ativo",
  notes: "",
  contract_start_date: "",
  contract_end_date: "",
};

function ClientModal({
  initial = null,
  onClose,
  onSave,
}: {
  initial?: Client | null;
  onClose: () => void;
  onSave: (values: ClientFormValues) => Promise<string | null>;
}) {
  const [values, setValues] = useState<ClientFormValues>(
    initial
      ? {
          full_name: initial.full_name,
          email: initial.email ?? "",
          phone: initial.phone ?? "",
          document: initial.document ?? "",
          category: initial.category ?? "",
          city: initial.city ?? "",
          monthly_value: initial.monthly_value !== null ? String(initial.monthly_value) : "",
          status: initial.status,
          notes: initial.notes ?? "",
          contract_start_date: initial.contract_start_date ?? "",
          contract_end_date: initial.contract_end_date ?? "",
        }
      : EMPTY_FORM
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

  function set<K extends keyof ClientFormValues>(key: K, value: ClientFormValues[K]) {
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
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <h3 className="font-serif text-xl text-neutral-900">
            {initial ? "Editar cliente" : "Novo cliente"}
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
              Nome *
            </label>
            <input
              type="text"
              value={values.full_name}
              onChange={(e) => set("full_name", e.target.value)}
              required
              autoFocus
              className="w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
              Telefone
            </label>
            <input
              type="text"
              placeholder="(11) 91234-5678"
              value={values.phone}
              onChange={(e) => set("phone", e.target.value)}
              className="w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
              E-mail
            </label>
            <input
              type="email"
              value={values.email}
              onChange={(e) => set("email", e.target.value)}
              className="w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
                CPF/CNPJ
              </label>
              <input
                type="text"
                value={values.document}
                onChange={(e) => set("document", e.target.value)}
                className="w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
                Categoria
              </label>
              <input
                type="text"
                placeholder="Ex.: Restaurante"
                value={values.category}
                onChange={(e) => set("category", e.target.value)}
                className="w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
              Cidade
            </label>
            <input
              type="text"
              value={values.city}
              onChange={(e) => set("city", e.target.value)}
              className="w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
                Valor mensal
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="R$ 0,00"
                value={values.monthly_value}
                onChange={(e) => set("monthly_value", e.target.value)}
                className="w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
                Status
              </label>
              <select
                value={values.status}
                onChange={(e) => set("status", e.target.value as ClientStatus)}
                className="w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700"
              >
                {(Object.keys(CLIENT_STATUS_LABELS) as ClientStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {CLIENT_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
                Início do contrato
              </label>
              <input
                type="date"
                value={values.contract_start_date}
                onChange={(e) => set("contract_start_date", e.target.value)}
                className="w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
                Fim do contrato
              </label>
              <input
                type="date"
                value={values.contract_end_date}
                onChange={(e) => set("contract_end_date", e.target.value)}
                className="w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700"
              />
            </div>
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
            {saving ? "Salvando..." : initial ? "Salvar alterações" : "Cadastrar cliente"}
          </button>
        </div>
      </form>
    </div>
  );
}

interface ClientDetailModalProps {
  client: Client;
  onClose: () => void;
  onSaveField: (id: string, patch: Partial<Client>) => Promise<string | null>;
  onFullEdit: (id: string, values: ClientFormValues) => Promise<string | null>;
}

function ClientDetailModal({ client, onClose, onSaveField, onFullEdit }: ClientDetailModalProps) {
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [editingFull, setEditingFull] = useState(false);
  const [notes, setNotes] = useState(client.notes ?? "");
  const [document, setDocumentValue] = useState(client.document ?? "");
  const [category, setCategory] = useState(client.category ?? "");
  const [city, setCity] = useState(client.city ?? "");
  const [monthlyValue, setMonthlyValue] = useState(
    client.monthly_value !== null ? String(client.monthly_value) : ""
  );
  const [savingField, setSavingField] = useState<string | null>(null);

  useEffect(() => {
    setNotes(client.notes ?? "");
    setDocumentValue(client.document ?? "");
    setCategory(client.category ?? "");
    setCity(client.city ?? "");
    setMonthlyValue(client.monthly_value !== null ? String(client.monthly_value) : "");
  }, [client.id, client.notes, client.document, client.category, client.city, client.monthly_value]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/clients/${client.id}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setProposals(data.proposals ?? []);
      })
      .catch(() => {
        if (!cancelled) setProposals([]);
      });
    return () => {
      cancelled = true;
    };
  }, [client.id]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function saveField(field: string, patch: Partial<Client>) {
    setSavingField(field);
    await onSaveField(client.id, patch);
    setSavingField(null);
  }

  const wa = whatsappUrl(client.phone);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 className="font-serif text-xl text-neutral-900">{client.full_name}</h3>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setEditingFull(true)}
              className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100"
            >
              Editar dados
            </button>
            <button
              onClick={onClose}
              className="text-lg leading-none text-neutral-400 hover:text-neutral-900"
              aria-label="Fechar"
            >
              ✕
            </button>
          </div>
        </div>

        {(() => {
          const today = todayISODate();
          const urgency = contractUrgency(client.contract_end_date, today);
          if (urgency !== "warning" && urgency !== "expired") return null;
          const diff = client.contract_end_date ? daysUntil(client.contract_end_date, today) : 0;
          const message =
            urgency === "expired"
              ? `Contrato vencido há ${Math.abs(diff)} dia(s) (${formatDateOnly(client.contract_end_date)}). Considere renovar ou atualizar o status do cliente.`
              : diff === 0
                ? `Contrato vence hoje (${formatDateOnly(client.contract_end_date)}).`
                : `Contrato vence em ${diff} dia(s) (${formatDateOnly(client.contract_end_date)}). Hora de conversar sobre a renovação.`;
          return (
            <div
              className={`mb-4 rounded-md border px-3 py-2 text-xs font-medium ${
                urgency === "expired"
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-amber-200 bg-amber-50 text-amber-700"
              }`}
            >
              ⚠️ {message}
            </div>
          );
        })()}

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Telefone</p>
            <p className="text-neutral-800">
              {client.phone ?? "—"}
              {wa && (
                <a
                  href={wa}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-2 text-xs font-medium text-emerald-600 hover:underline"
                >
                  WhatsApp
                </a>
              )}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">E-mail</p>
            <p className="text-neutral-800">{client.email ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Início do contrato</p>
            <p className="text-neutral-800">{formatDateOnly(client.contract_start_date)}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Fim do contrato</p>
            <p className="text-neutral-800">{formatDateOnly(client.contract_end_date)}</p>
          </div>
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
            Status
          </label>
          <select
            value={client.status}
            onChange={(e) => saveField("status", { status: e.target.value as ClientStatus })}
            className="w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700"
          >
            {(Object.keys(CLIENT_STATUS_LABELS) as ClientStatus[]).map((s) => (
              <option key={s} value={s}>
                {CLIENT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
              Valor mensal
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="R$ 0,00"
                value={monthlyValue}
                onChange={(e) => setMonthlyValue(e.target.value)}
                className="min-w-0 flex-1 rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700"
              />
              <button
                disabled={savingField === "monthly_value"}
                onClick={() => {
                  const parsed = monthlyValue.trim() ? Number(monthlyValue) : null;
                  saveField("monthly_value", {
                    monthly_value: parsed !== null && !Number.isNaN(parsed) ? parsed : null,
                  });
                }}
                className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
              >
                Salvar
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
              CPF/CNPJ
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={document}
                onChange={(e) => setDocumentValue(e.target.value)}
                className="min-w-0 flex-1 rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700"
              />
              <button
                disabled={savingField === "document"}
                onClick={() => saveField("document", { document: document.trim() || null })}
                className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
              >
                Salvar
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
              Categoria
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="min-w-0 flex-1 rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700"
              />
              <button
                disabled={savingField === "category"}
                onClick={() => saveField("category", { category: category.trim() || null })}
                className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
              >
                Salvar
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
              Cidade
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="min-w-0 flex-1 rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700"
              />
              <button
                disabled={savingField === "city"}
                onClick={() => saveField("city", { city: city.trim() || null })}
                className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
              >
                Salvar
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
            Observações
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700"
          />
          <button
            disabled={savingField === "notes"}
            onClick={() => saveField("notes", { notes: notes.trim() || null })}
            className="mt-2 rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
          >
            Salvar observações
          </button>
        </div>

        <div className="mt-5 border-t border-neutral-200 pt-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Propostas</p>
            <Link
              href={`/dashboard/propostas?cliente=${client.id}`}
              className="text-xs font-medium text-neutral-600 hover:text-neutral-900 hover:underline"
            >
              Nova proposta →
            </Link>
          </div>
          {proposals === null ? (
            <p className="text-sm text-neutral-400">Carregando...</p>
          ) : proposals.length === 0 ? (
            <p className="text-sm text-neutral-400">Nenhuma proposta vinculada ainda.</p>
          ) : (
            <ul className="space-y-2">
              {proposals.map((p) => (
                <li
                  key={p.id}
                  className="rounded-md border border-neutral-200 px-3 py-2 text-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-neutral-800">{p.title}</span>
                    <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
                      {formatCurrency(p.value)}
                    </span>
                  </div>
                  {p.service_type && (
                    <p className="mt-0.5 text-xs text-neutral-400">{p.service_type}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <ClientTasksPanel clientId={client.id} />
      </div>

      {editingFull && (
        // stopPropagation aqui evita que um clique no backdrop do
        // ClientModal (que já fecha só o modal de edição via seu próprio
        // onClose) borbulhe até o backdrop deste modal de detalhe e feche
        // os dois de uma vez.
        <div onClick={(e) => e.stopPropagation()}>
          <ClientModal
            initial={client}
            onClose={() => setEditingFull(false)}
            onSave={(values) => onFullEdit(client.id, values)}
          />
        </div>
      )}
    </div>
  );
}

export default function ClientesClient({
  initialClients,
  proposalCounts,
}: {
  initialClients: Client[];
  proposalCounts: Record<string, number>;
}) {
  const [clients, setClients] = useState<Client[]>(initialClients);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ClientStatus>("all");
  const [showNewModal, setShowNewModal] = useState(false);
  const [detailClient, setDetailClient] = useState<Client | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients.filter((c) => {
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (!q) return true;
      return [c.full_name, c.email, c.phone, c.city, c.category, c.document]
        .filter(Boolean)
        .some((field) => (field as string).toLowerCase().includes(q));
    });
  }, [clients, search, statusFilter]);

  const expiringContracts = useMemo(() => {
    const today = todayISODate();
    return clients
      .filter((c) => c.status === "ativo")
      .map((c) => ({ client: c, urgency: contractUrgency(c.contract_end_date, today) }))
      .filter((x) => x.urgency === "expired" || x.urgency === "warning")
      .sort((a, b) => (a.client.contract_end_date ?? "").localeCompare(b.client.contract_end_date ?? ""));
  }, [clients]);

  async function handleCreate(values: ClientFormValues): Promise<string | null> {
    const parsedValue = values.monthly_value.trim() ? Number(values.monthly_value) : null;
    const res = await fetch("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...values,
        monthly_value: parsedValue !== null && !Number.isNaN(parsedValue) ? parsedValue : null,
      }),
    });
    const data = await res.json();
    if (!res.ok) return data.error ?? "Erro ao cadastrar cliente";
    setClients((prev) =>
      [...prev, data.client].sort((a, b) => a.full_name.localeCompare(b.full_name))
    );
    return null;
  }

  async function handleFullUpdate(id: string, values: ClientFormValues): Promise<string | null> {
    const parsedValue = values.monthly_value.trim() ? Number(values.monthly_value) : null;
    return handleSaveField(id, {
      full_name: values.full_name.trim(),
      email: values.email.trim() || null,
      phone: values.phone.trim() || null,
      document: values.document.trim() || null,
      category: values.category.trim() || null,
      city: values.city.trim() || null,
      monthly_value: parsedValue !== null && !Number.isNaN(parsedValue) ? parsedValue : null,
      status: values.status,
      notes: values.notes.trim() || null,
      contract_start_date: values.contract_start_date || null,
      contract_end_date: values.contract_end_date || null,
    });
  }

  async function handleSaveField(id: string, patch: Partial<Client>): Promise<string | null> {
    const prevClients = clients;
    setClients((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    if (detailClient?.id === id) setDetailClient((c) => (c ? { ...c, ...patch } : c));

    const res = await fetch(`/api/clients/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setClients(prevClients);
      return data.error ?? "Erro ao salvar cliente";
    }
    setClients((prev) =>
      prev
        .map((c) => (c.id === id ? data.client : c))
        .sort((a, b) => a.full_name.localeCompare(b.full_name))
    );
    if (detailClient?.id === id) setDetailClient(data.client);
    return null;
  }

  return (
    <div className="min-h-screen bg-neutral-100">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <h1 className="font-serif text-2xl text-neutral-900">Clientes</h1>
          <button
            onClick={() => setShowNewModal(true)}
            className="rounded-md bg-neutral-900 px-4 py-2 text-xs font-medium text-white hover:bg-neutral-700"
          >
            + Novo cliente
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6">
        {expiringContracts.length > 0 && (
          <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <p className="font-medium">
              ⚠️ {expiringContracts.length} contrato(s) ativo(s) vencido(s) ou vencendo nos próximos{" "}
              {CONTRACT_WARNING_DAYS} dias:
            </p>
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {expiringContracts.map(({ client, urgency }) => (
                <li key={client.id}>
                  <button
                    type="button"
                    onClick={() => setDetailClient(client)}
                    className={`font-medium hover:underline ${
                      urgency === "expired" ? "text-red-700" : "text-amber-800"
                    }`}
                  >
                    {client.full_name}
                  </button>{" "}
                  ({formatDateOnly(client.contract_end_date)})
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <input
            type="text"
            placeholder="Buscar por nome, telefone, e-mail, cidade, CPF/CNPJ..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-[240px] flex-1 max-w-sm rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "all" | ClientStatus)}
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-700"
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {s === "all" ? "Todos os status" : CLIENT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          {(search || statusFilter !== "all") && (
            <span className="text-xs text-neutral-400">
              {filtered.length} de {clients.length} clientes
            </span>
          )}
        </div>

        {filtered.length === 0 ? (
          <p className="rounded-md border border-dashed border-neutral-300 bg-white px-4 py-8 text-center text-sm text-neutral-400">
            {clients.length === 0
              ? "Nenhum cliente cadastrado ainda."
              : "Nenhum cliente encontrado para essa busca."}
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs font-medium uppercase tracking-wide text-neutral-500">
                  <th className="px-4 py-2.5">Nome</th>
                  <th className="px-4 py-2.5">Telefone</th>
                  <th className="px-4 py-2.5">Cidade</th>
                  <th className="px-4 py-2.5">Categoria</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Valor mensal</th>
                  <th className="px-4 py-2.5">Contrato até</th>
                  <th className="px-4 py-2.5">Propostas</th>
                  <th className="px-4 py-2.5">Desde</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr
                    key={c.id}
                    className="cursor-pointer border-b border-neutral-100 last:border-0 hover:bg-neutral-50"
                  >
                    <td
                      className="px-4 py-2.5 font-medium text-neutral-800"
                      onClick={() => setDetailClient(c)}
                    >
                      {c.full_name}
                    </td>
                    <td className="px-4 py-2.5 text-neutral-600" onClick={() => setDetailClient(c)}>
                      {c.phone ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-neutral-600" onClick={() => setDetailClient(c)}>
                      {c.city ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-neutral-600" onClick={() => setDetailClient(c)}>
                      {c.category ?? "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <select
                        value={c.status}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) =>
                          handleSaveField(c.id, { status: e.target.value as ClientStatus })
                        }
                        className="rounded border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-700"
                      >
                        {(Object.keys(CLIENT_STATUS_LABELS) as ClientStatus[]).map((s) => (
                          <option key={s} value={s}>
                            {CLIENT_STATUS_LABELS[s]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2.5 font-medium text-emerald-700">
                      {formatCurrency(c.monthly_value)}
                    </td>
                    <td className="px-4 py-2.5 text-xs" onClick={() => setDetailClient(c)}>
                      <ContractBadge endDate={c.contract_end_date} today={todayISODate()} />
                    </td>
                    <td className="px-4 py-2.5 text-neutral-500">
                      {proposalCounts[c.id] ?? 0}
                    </td>
                    <td
                      className="px-4 py-2.5 text-neutral-400"
                      onClick={() => setDetailClient(c)}
                    >
                      {formatDate(c.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {showNewModal && (
        <ClientModal onClose={() => setShowNewModal(false)} onSave={handleCreate} />
      )}

      {detailClient && (
        <ClientDetailModal
          client={detailClient}
          onClose={() => setDetailClient(null)}
          onSaveField={handleSaveField}
          onFullEdit={handleFullUpdate}
        />
      )}
    </div>
  );
}
