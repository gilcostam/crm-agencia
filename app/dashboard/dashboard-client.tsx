"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Lead,
  LeadAttachment,
  LeadEvent,
  LeadStatus,
  STATUS_LABELS,
  STATUS_ORDER,
} from "@/lib/types";
import { sanitizePhone } from "@/lib/phone";

const POLL_INTERVAL_MS = 4000;
const STALE_STATUSES: LeadStatus[] = [
  "novo_lead",
  "primeiro_contato",
  "segundo_contato",
  "terceiro_contato",
  "reuniao_marcada",
];
const STALE_DAYS_THRESHOLD = 3;

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "agora mesmo";
  if (diffMin < 60) return `há ${diffMin}min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `há ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  return `há ${diffD}d`;
}

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** true se o horário ISO cai no dia de hoje (fuso local do navegador). */
function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function whatsappUrl(phone: string | null, leadName: string | null): string | null {
  const digits = sanitizePhone(phone);
  if (!digits) return null;
  const firstName = leadName?.trim().split(" ")[0] || "";
  const message = encodeURIComponent(
    `Olá${firstName ? " " + firstName : ""}! Aqui é da equipe da No Limits, vi seu contato e gostaria de conversar sobre marketing digital para o seu negócio.`
  );
  return `https://wa.me/${digits}?text=${message}`;
}

function toGoogleCalendarStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function googleCalendarUrl(lead: Lead): string {
  const start = lead.meeting_datetime
    ? new Date(lead.meeting_datetime)
    : new Date(Date.now() + 60 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  const details = [
    lead.email ? `E-mail: ${lead.email}` : null,
    lead.phone ? `Telefone: ${lead.phone}` : null,
    lead.source ? `Origem: ${lead.source}` : null,
    lead.category ? `Categoria: ${lead.category}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `Reunião com ${lead.full_name || "lead"} — No Limits`,
    dates: `${toGoogleCalendarStamp(start)}/${toGoogleCalendarStamp(end)}`,
    details,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

/** Toca um bip curto via Web Audio API (sem precisar de nenhum arquivo de
 * áudio externo). Se o navegador bloquear autoplay antes da primeira
 * interação do usuário, falha em silêncio — não é crítico. */
function playNotificationSound() {
  try {
    const AudioCtxClass =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtxClass) return;
    const ctx = new AudioCtxClass();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.4);
    oscillator.onended = () => ctx.close();
  } catch {
    // autoplay bloqueado ou API indisponível — silencioso
  }
}

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function exportLeadsToCsv(leads: Lead[]) {
  const headers = [
    "Nome",
    "Telefone",
    "E-mail",
    "Cidade",
    "Categoria",
    "Status",
    "Origem",
    "Valor mensal",
    "Próximo follow-up",
    "Recebido em",
    "Observações",
  ];
  const rows = leads.map((l) => [
    l.full_name ?? "",
    l.phone ?? "",
    l.email ?? "",
    l.city ?? "",
    l.category ?? "",
    STATUS_LABELS[l.status],
    l.source ?? "",
    l.monthly_value !== null ? String(l.monthly_value) : "",
    l.next_followup ?? "",
    formatDate(l.created_at),
    (l.notes ?? "").replace(/\n/g, " "),
  ]);
  const csv = [headers, ...rows].map((r) => r.map((v) => csvEscape(String(v))).join(",")).join("\n");
  // BOM no início ajuda o Excel a reconhecer acentuação em UTF-8 corretamente.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `leads_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M12.04 2c-5.5 0-9.96 4.46-9.96 9.96 0 1.76.46 3.48 1.34 5L2 22l5.2-1.36a9.94 9.94 0 0 0 4.84 1.23h.01c5.5 0 9.96-4.46 9.96-9.96S17.55 2 12.04 2Zm5.84 14.24c-.25.7-1.45 1.34-2 1.43-.51.08-1.15.11-1.86-.12-.43-.13-.98-.32-1.68-.62-2.96-1.28-4.89-4.26-5.04-4.46-.15-.2-1.2-1.6-1.2-3.05 0-1.45.76-2.16 1.03-2.46.27-.3.59-.37.79-.37.2 0 .4 0 .57.01.18.01.43-.07.67.51.25.6.86 2.07.93 2.22.07.15.12.33.02.53-.1.2-.15.33-.3.5-.15.18-.31.4-.45.54-.15.15-.3.31-.13.61.17.3.76 1.25 1.63 2.02 1.12 1 2.06 1.31 2.36 1.46.3.15.48.13.65-.08.18-.2.75-.87.95-1.17.2-.3.4-.25.67-.15.28.1 1.75.83 2.05 .98.3.15.5.23.57.35.08.13.08.72-.17 1.41Z" />
    </svg>
  );
}

interface LeadDetailModalProps {
  lead: Lead;
  duplicateLeads: Lead[];
  onClose: () => void;
  onUpdateStatus: (id: string, status: LeadStatus) => void;
  onSaveNotes: (id: string, notes: string) => Promise<void>;
  onSaveMeeting: (id: string, meetingIso: string | null) => Promise<void>;
  onSaveMonthlyValue: (id: string, value: number | null) => Promise<void>;
  onSaveNextFollowup: (id: string, date: string | null) => Promise<void>;
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-neutral-400">{label}</dt>
      <dd className="break-words text-neutral-800">{value || "—"}</dd>
    </div>
  );
}

function LeadDetailModal({
  lead,
  duplicateLeads,
  onClose,
  onUpdateStatus,
  onSaveNotes,
  onSaveMeeting,
  onSaveMonthlyValue,
  onSaveNextFollowup,
}: LeadDetailModalProps) {
  const [notes, setNotes] = useState(lead.notes ?? "");
  const [meetingValue, setMeetingValue] = useState(toDatetimeLocalValue(lead.meeting_datetime));
  const [savingNotes, setSavingNotes] = useState(false);
  const [savingMeeting, setSavingMeeting] = useState(false);
  const [monthlyValue, setMonthlyValue] = useState(
    lead.monthly_value !== null ? String(lead.monthly_value) : ""
  );
  const [savingValue, setSavingValue] = useState(false);
  const [nextFollowup, setNextFollowup] = useState(lead.next_followup ?? "");
  const [savingFollowup, setSavingFollowup] = useState(false);
  const [sendingWhatsapp, setSendingWhatsapp] = useState(false);
  const [whatsappResult, setWhatsappResult] = useState<{ ok: boolean; message: string } | null>(null);

  const [events, setEvents] = useState<LeadEvent[]>([]);
  const [attachments, setAttachments] = useState<LeadAttachment[]>([]);
  const [loadingExtras, setLoadingExtras] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setNotes(lead.notes ?? "");
    setMeetingValue(toDatetimeLocalValue(lead.meeting_datetime));
    setMonthlyValue(lead.monthly_value !== null ? String(lead.monthly_value) : "");
    setNextFollowup(lead.next_followup ?? "");
  }, [lead.id, lead.notes, lead.meeting_datetime, lead.monthly_value, lead.next_followup]);

  useEffect(() => {
    let cancelled = false;
    setLoadingExtras(true);
    Promise.all([
      fetch(`/api/leads/${lead.id}/events`)
        .then((r) => (r.ok ? r.json() : { events: [] }))
        .catch(() => ({ events: [] })),
      fetch(`/api/leads/${lead.id}/attachments`)
        .then((r) => (r.ok ? r.json() : { attachments: [] }))
        .catch(() => ({ attachments: [] })),
    ]).then(([eventsData, attachmentsData]) => {
      if (cancelled) return;
      setEvents(eventsData.events ?? []);
      setAttachments(attachmentsData.attachments ?? []);
      setLoadingExtras(false);
    });
    return () => {
      cancelled = true;
    };
  }, [lead.id]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/leads/${lead.id}/attachments`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setUploadError(data.error ?? "Erro ao enviar arquivo.");
      } else {
        setAttachments((prev) => [data.attachment, ...prev]);
      }
    } catch {
      setUploadError("Erro de conexão ao enviar arquivo.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDeleteAttachment(attachmentId: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
    await fetch(`/api/leads/${lead.id}/attachments/${attachmentId}`, { method: "DELETE" });
  }

  async function handleTriggerWhatsapp() {
    setSendingWhatsapp(true);
    setWhatsappResult(null);
    try {
      const res = await fetch(`/api/leads/${lead.id}/whatsapp/trigger`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setWhatsappResult({ ok: false, message: data.error ?? "Erro ao disparar sequência." });
      } else {
        setWhatsappResult({ ok: true, message: "Sequência disparada com sucesso." });
        fetch(`/api/leads/${lead.id}/events`)
          .then((r) => (r.ok ? r.json() : { events: [] }))
          .then((data) => setEvents(data.events ?? []))
          .catch(() => {});
      }
    } catch {
      setWhatsappResult({ ok: false, message: "Erro de conexão ao disparar sequência." });
    } finally {
      setSendingWhatsapp(false);
    }
  }

  const wa = whatsappUrl(lead.phone, lead.full_name);
  const alreadySentWhatsapp = events.some((e) => e.type === "whatsapp_sent");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="font-serif text-xl text-neutral-900">
              {lead.full_name || "Sem nome"}
            </h3>
            <p className="text-xs uppercase tracking-wide text-neutral-400">
              {STATUS_LABELS[lead.status]}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-lg leading-none text-neutral-400 hover:text-neutral-900"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        {duplicateLeads.length > 0 && (
          <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            ⚠️ Possível duplicata — o mesmo telefone também aparece em:{" "}
            {duplicateLeads.map((d) => d.full_name || "sem nome").join(", ")}
          </div>
        )}

        {lead.converted_to_client_id && (
          <div className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            ✓ Este lead já foi convertido em cliente automaticamente.{" "}
            <Link href="/dashboard/clientes" className="underline decoration-dotted hover:text-emerald-950">
              Ver na lista de clientes →
            </Link>
          </div>
        )}

        <div className="mb-4 flex flex-wrap gap-2">
          {wa && (
            <a
              href={wa}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600"
            >
              <WhatsAppIcon />
              Conversar no WhatsApp
            </a>
          )}
          {lead.email && (
            <a
              href={`mailto:${lead.email}`}
              className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
            >
              Enviar e-mail
            </a>
          )}
          <a
            href={googleCalendarUrl(lead)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
          >
            Adicionar ao Google Agenda
          </a>
          <button
            type="button"
            disabled={sendingWhatsapp || !lead.phone}
            onClick={handleTriggerWhatsapp}
            title={!lead.phone ? "Lead sem telefone cadastrado" : undefined}
            className="inline-flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
          >
            {sendingWhatsapp
              ? "Disparando..."
              : alreadySentWhatsapp
                ? "Reenviar sequência WhatsApp"
                : "Disparar sequência WhatsApp"}
          </button>
        </div>
        {alreadySentWhatsapp && !whatsappResult && (
          <p className="mb-3 text-xs text-neutral-500">
            ℹ️ Sequência de WhatsApp já foi iniciada para este lead (veja o histórico abaixo).
          </p>
        )}
        {whatsappResult && (
          <p className={`mb-3 text-xs ${whatsappResult.ok ? "text-emerald-700" : "text-red-600"}`}>
            {whatsappResult.message}
          </p>
        )}

        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
          <Field label="Telefone" value={lead.phone} />
          <Field label="E-mail" value={lead.email} />
          <Field label="Cidade" value={lead.city} />
          <Field label="Categoria" value={lead.category} />
          <Field label="Origem" value={lead.source} />
          <Field label="Recebido em" value={formatDate(lead.created_at)} />
          <Field label="Atualizado em" value={formatDate(lead.updated_at)} />
        </dl>

        <div className="mt-5">
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
            Status
          </label>
          <select
            value={lead.status}
            onChange={(e) => onUpdateStatus(lead.id, e.target.value as LeadStatus)}
            className="w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700"
          >
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
            Reunião agendada
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              type="datetime-local"
              value={meetingValue}
              onChange={(e) => setMeetingValue(e.target.value)}
              className="min-w-0 flex-1 rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700"
            />
            <button
              disabled={savingMeeting}
              onClick={async () => {
                setSavingMeeting(true);
                const iso = meetingValue ? new Date(meetingValue).toISOString() : null;
                await onSaveMeeting(lead.id, iso);
                setSavingMeeting(false);
              }}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
            >
              Salvar
            </button>
            {lead.meeting_datetime && (
              <button
                disabled={savingMeeting}
                onClick={async () => {
                  setSavingMeeting(true);
                  setMeetingValue("");
                  await onSaveMeeting(lead.id, null);
                  setSavingMeeting(false);
                }}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100"
              >
                Remover
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
              Valor mensal
            </label>
            <div className="flex flex-wrap gap-2">
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
                disabled={savingValue}
                onClick={async () => {
                  setSavingValue(true);
                  const parsed = monthlyValue.trim() ? Number(monthlyValue) : null;
                  await onSaveMonthlyValue(lead.id, parsed !== null && !Number.isNaN(parsed) ? parsed : null);
                  setSavingValue(false);
                }}
                className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
              >
                Salvar
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
              Próximo follow-up
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                type="date"
                value={nextFollowup}
                onChange={(e) => setNextFollowup(e.target.value)}
                className="min-w-0 flex-1 rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700"
              />
              <button
                disabled={savingFollowup}
                onClick={async () => {
                  setSavingFollowup(true);
                  await onSaveNextFollowup(lead.id, nextFollowup || null);
                  setSavingFollowup(false);
                }}
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
            disabled={savingNotes}
            onClick={async () => {
              setSavingNotes(true);
              await onSaveNotes(lead.id, notes);
              setSavingNotes(false);
            }}
            className="mt-2 rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
          >
            Salvar observações
          </button>
        </div>

        <div className="mt-5">
          <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-neutral-500">
            Anexos
          </label>
          <div className="space-y-2">
            {attachments.map((att) => (
              <div
                key={att.id}
                className="flex items-center justify-between gap-2 rounded border border-neutral-200 px-2 py-1.5 text-xs"
              >
                <a
                  href={att.url ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate text-neutral-700 hover:underline"
                >
                  {att.file_name}
                </a>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-neutral-400">{formatBytes(att.size_bytes)}</span>
                  <button
                    onClick={() => handleDeleteAttachment(att.id)}
                    className="text-red-500 hover:text-red-700"
                  >
                    Remover
                  </button>
                </div>
              </div>
            ))}
            {attachments.length === 0 && !loadingExtras && (
              <p className="text-xs text-neutral-400">Nenhum arquivo anexado.</p>
            )}
          </div>
          <div className="mt-2">
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleUpload}
              disabled={uploading}
              className="text-xs text-neutral-600"
            />
            {uploading && <p className="mt-1 text-[10px] text-neutral-400">Enviando...</p>}
            {uploadError && <p className="mt-1 text-[10px] text-red-600">{uploadError}</p>}
          </div>
        </div>

        <div className="mt-5">
          <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-neutral-500">
            Histórico
          </label>
          {loadingExtras ? (
            <p className="text-xs text-neutral-400">Carregando...</p>
          ) : events.length === 0 ? (
            <p className="text-xs text-neutral-400">Sem eventos registrados ainda.</p>
          ) : (
            <ul className="space-y-2 border-l border-neutral-200 pl-3">
              {events.map((ev) => (
                <li key={ev.id} className="text-xs">
                  <p className="text-neutral-700">{ev.message}</p>
                  <p className="text-[10px] text-neutral-400">{timeAgo(ev.created_at)}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

interface NewLeadModalProps {
  onClose: () => void;
  onCreate: (payload: {
    full_name: string;
    phone: string;
    email: string;
    city: string;
    category: string;
    notes: string;
    status: LeadStatus;
    monthly_value: number | null;
  }) => Promise<string | null>;
}

function NewLeadModal({ onClose, onCreate }: NewLeadModalProps) {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [city, setCity] = useState("");
  const [category, setCategory] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<LeadStatus>("novo_lead");
  const [monthlyValue, setMonthlyValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const parsedValue = monthlyValue.trim() ? Number(monthlyValue) : null;
    const errMsg = await onCreate({
      full_name: fullName,
      phone,
      email,
      city,
      category,
      notes,
      status,
      monthly_value: parsedValue !== null && !Number.isNaN(parsedValue) ? parsedValue : null,
    });
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
          <h3 className="font-serif text-xl text-neutral-900">Novo lead</h3>
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
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
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
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
              E-mail
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
                Cidade
              </label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
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
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
              Status
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as LeadStatus)}
              className="w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700"
            >
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
              Valor mensal
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="R$ 0,00"
              value={monthlyValue}
              onChange={(e) => setMonthlyValue(e.target.value)}
              className="w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
              Observações
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
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
            {saving ? "Salvando..." : "Cadastrar lead"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function DashboardClient({
  initialLeads,
}: {
  initialLeads: Lead[];
}) {
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const knownIds = useRef<Set<string>>(new Set(initialLeads.map((l) => l.id)));
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dragOverStatus, setDragOverStatus] = useState<LeadStatus | null>(null);
  const [showNewLeadModal, setShowNewLeadModal] = useState(false);
  const [conversionNotice, setConversionNotice] = useState<{ leadName: string } | null>(null);
  // Controla quais lembretes já notificamos nesta sessão, pra não repetir
  // a cada ciclo de polling (4s) enquanto a aba fica aberta. Pré-populado
  // com o estado já existente ao abrir a página — os selos visuais no
  // quadro já cobrem isso; a notificação é só pra mudanças em tempo real.
  const notifiedMeetingIds = useRef<Set<string>>(
    new Set(
      initialLeads
        .filter((l) => {
          if (!l.meeting_datetime) return false;
          const diffMs = new Date(l.meeting_datetime).getTime() - Date.now();
          return !(diffMs > 0 && diffMs <= 30 * 60 * 1000);
        })
        .map((l) => l.id)
    )
  );
  const notifiedStaleIds = useRef<Set<string>>(
    new Set(
      initialLeads
        .filter(
          (l) =>
            STALE_STATUSES.includes(l.status) && daysSince(l.updated_at) >= STALE_DAYS_THRESHOLD
        )
        .map((l) => l.id)
    )
  );

  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/leads", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      const newLeads: Lead[] = data.leads ?? [];

      const freshlyArrived = newLeads.filter((l) => !knownIds.current.has(l.id));
      if (freshlyArrived.length > 0) {
        setFlashIds(new Set(freshlyArrived.map((l) => l.id)));
        setTimeout(() => setFlashIds(new Set()), 3000);
        playNotificationSound();
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          const title =
            freshlyArrived.length === 1
              ? `Novo lead: ${freshlyArrived[0].full_name || "sem nome"}`
              : `${freshlyArrived.length} novos leads`;
          new Notification(title, { body: "Clique pra abrir o CRM" });
        }
      }
      knownIds.current = new Set(newLeads.map((l) => l.id));

      // Lembrete proativo: reunião chegando nos próximos 30min (avisa uma
      // única vez por lead enquanto a aba ficar aberta).
      const now = Date.now();
      for (const l of newLeads) {
        if (!l.meeting_datetime || notifiedMeetingIds.current.has(l.id)) continue;
        const diffMs = new Date(l.meeting_datetime).getTime() - now;
        if (diffMs > 0 && diffMs <= 30 * 60 * 1000) {
          notifiedMeetingIds.current.add(l.id);
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            new Notification(`Reunião em breve: ${l.full_name || "lead"}`, {
              body: `Às ${new Date(l.meeting_datetime).toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
              })}`,
            });
          }
        }
      }

      // Lembrete proativo: lead que acabou de cruzar o limite de "parado
      // sem contato" (avisa uma única vez, não a cada poll).
      for (const l of newLeads) {
        if (notifiedStaleIds.current.has(l.id)) continue;
        const isStale =
          STALE_STATUSES.includes(l.status) && daysSince(l.updated_at) >= STALE_DAYS_THRESHOLD;
        if (isStale) {
          notifiedStaleIds.current.add(l.id);
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            new Notification(`Lead parado: ${l.full_name || "sem nome"}`, {
              body: `Sem contato há ${daysSince(l.updated_at)} dias`,
            });
          }
        }
      }

      setLeads(newLeads);
      setLastUpdate(new Date());
    } catch {
      // silencioso: próxima tentativa de polling resolve
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    if (!conversionNotice) return;
    const timeout = setTimeout(() => setConversionNotice(null), 12000);
    return () => clearTimeout(timeout);
  }, [conversionNotice]);

  async function updateStatus(id: string, status: LeadStatus) {
    const previousLead = leads.find((l) => l.id === id);
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, status } : l)));
    const res = await fetch(`/api/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await res.json().catch(() => ({}));

    // Ao entrar em "Contrato Assinado", o backend converte o lead em cliente
    // automaticamente (ver app/api/leads/[id]/route.ts) — aqui só exibimos o
    // aviso quando a conversão de fato aconteceu nesta chamada.
    if (
      res.ok &&
      status === "contrato_assinado" &&
      previousLead &&
      !previousLead.converted_to_client_id &&
      data.lead?.converted_to_client_id
    ) {
      setConversionNotice({ leadName: previousLead.full_name || "Lead" });
    }

    refresh();
  }

  async function saveNotes(id: string, notes: string) {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, notes } : l)));
    await fetch(`/api/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
    refresh();
  }

  async function saveMeeting(id: string, meetingIso: string | null) {
    setLeads((prev) =>
      prev.map((l) => (l.id === id ? { ...l, meeting_datetime: meetingIso } : l))
    );
    await fetch(`/api/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meeting_datetime: meetingIso }),
    });
    refresh();
  }

  async function saveMonthlyValue(id: string, value: number | null) {
    setLeads((prev) =>
      prev.map((l) => (l.id === id ? { ...l, monthly_value: value } : l))
    );
    await fetch(`/api/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monthly_value: value }),
    });
    refresh();
  }

  async function saveNextFollowup(id: string, date: string | null) {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, next_followup: date } : l)));
    await fetch(`/api/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ next_followup: date }),
    });
    refresh();
  }

  async function createLead(payload: {
    full_name: string;
    phone: string;
    email: string;
    city: string;
    category: string;
    notes: string;
    status: LeadStatus;
    monthly_value: number | null;
  }): Promise<string | null> {
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return data.error ?? "Erro ao cadastrar lead.";
      }
      knownIds.current.add(data.lead.id);
      setLeads((prev) => [data.lead, ...prev]);
      return null;
    } catch {
      return "Erro de conexão ao cadastrar lead.";
    }
  }

  const sources = useMemo(() => {
    const set = new Set<string>();
    for (const l of leads) if (l.source) set.add(l.source);
    return Array.from(set).sort();
  }, [leads]);

  // Limites do período em horário local, incluindo o dia inteiro de "até"
  // (23:59:59.999) pra não cortar leads criados durante o próprio dia final.
  const dateFromMs = useMemo(() => {
    if (!dateFrom) return null;
    const d = new Date(`${dateFrom}T00:00:00`);
    return d.getTime();
  }, [dateFrom]);
  const dateToMs = useMemo(() => {
    if (!dateTo) return null;
    const d = new Date(`${dateTo}T23:59:59.999`);
    return d.getTime();
  }, [dateTo]);

  const filteredLeads = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads.filter((l) => {
      if (sourceFilter !== "all" && l.source !== sourceFilter) return false;
      if (dateFromMs !== null || dateToMs !== null) {
        const createdMs = new Date(l.created_at).getTime();
        if (dateFromMs !== null && createdMs < dateFromMs) return false;
        if (dateToMs !== null && createdMs > dateToMs) return false;
      }
      if (!q) return true;
      const haystack = [l.full_name, l.phone, l.email, l.city, l.category]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [leads, search, sourceFilter, dateFromMs, dateToMs]);

  // Agrupa leads pelo telefone normalizado, pra sinalizar possíveis duplicatas.
  const phoneGroups = useMemo(() => {
    const map = new Map<string, Lead[]>();
    for (const l of leads) {
      const key = sanitizePhone(l.phone);
      if (!key) continue;
      const arr = map.get(key) ?? [];
      arr.push(l);
      map.set(key, arr);
    }
    return map;
  }, [leads]);

  function duplicatesOf(lead: Lead): Lead[] {
    const key = sanitizePhone(lead.phone);
    if (!key) return [];
    return (phoneGroups.get(key) ?? []).filter((d) => d.id !== lead.id);
  }

  // Lembrete visível de reuniões marcadas pra hoje, ordenadas por horário —
  // não depende de permissão de notificação do navegador.
  const todaysMeetings = useMemo(() => {
    return leads
      .filter((l) => l.meeting_datetime && isToday(l.meeting_datetime))
      .sort(
        (a, b) =>
          new Date(a.meeting_datetime as string).getTime() -
          new Date(b.meeting_datetime as string).getTime()
      );
  }, [leads]);

  const selectedLead = leads.find((l) => l.id === selectedLeadId) ?? null;

  return (
    <div className="min-h-screen bg-neutral-100">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <h1 className="font-serif text-2xl text-neutral-900">Leads</h1>
          <span className="text-xs text-neutral-400">
            Atualizado {formatDate(lastUpdate.toISOString())}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        {todaysMeetings.length > 0 && (
          <div className="mb-5 rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
            📅 <strong>{todaysMeetings.length === 1 ? "Reunião hoje" : "Reuniões hoje"}:</strong>{" "}
            {todaysMeetings.map((l, i) => (
              <span key={l.id}>
                {i > 0 && ", "}
                <button
                  onClick={() => setSelectedLeadId(l.id)}
                  className="underline decoration-dotted hover:text-amber-950"
                >
                  {new Date(l.meeting_datetime as string).toLocaleTimeString("pt-BR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  {l.full_name || "sem nome"}
                </button>
              </span>
            ))}
          </div>
        )}

        {conversionNotice && (
          <div className="mb-5 flex items-center justify-between rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
            <span>
              ✅ <strong>{conversionNotice.leadName}</strong> foi cadastrado como cliente
              automaticamente.{" "}
              <Link href="/dashboard/clientes" className="underline decoration-dotted hover:text-emerald-950">
                Completar os dados do cliente →
              </Link>
            </span>
            <button
              onClick={() => setConversionNotice(null)}
              className="ml-3 shrink-0 text-emerald-500 hover:text-emerald-900"
              aria-label="Fechar aviso"
            >
              ✕
            </button>
          </div>
        )}

        <div className="mb-5 flex flex-wrap items-center gap-3">
          <input
            type="search"
            placeholder="Buscar por nome, telefone, e-mail, cidade ou categoria..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-[240px] flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-700 outline-none focus:border-neutral-900"
          />
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-700"
          >
            <option value="all">Todas as origens</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-neutral-500" htmlFor="date-from">
              De
            </label>
            <input
              id="date-from"
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-md border border-neutral-300 bg-white px-2 py-2 text-sm text-neutral-700"
            />
            <label className="text-xs text-neutral-500" htmlFor="date-to">
              até
            </label>
            <input
              id="date-to"
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded-md border border-neutral-300 bg-white px-2 py-2 text-sm text-neutral-700"
            />
            {(dateFrom || dateTo) && (
              <button
                onClick={() => {
                  setDateFrom("");
                  setDateTo("");
                }}
                title="Limpar período"
                className="text-xs text-neutral-400 hover:text-neutral-700"
              >
                ✕
              </button>
            )}
          </div>
          <button
            onClick={() => exportLeadsToCsv(filteredLeads)}
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Exportar CSV
          </button>
          <button
            onClick={() => setShowNewLeadModal(true)}
            className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-700"
          >
            + Novo lead
          </button>
          {(search || sourceFilter !== "all" || dateFrom || dateTo) && (
            <span className="text-xs text-neutral-400">
              {filteredLeads.length} de {leads.length} leads
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STATUS_ORDER.map((status) => {
            const columnLeads = filteredLeads.filter((l) => l.status === status);
            return (
              <div
                key={status}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDragOverStatus(status);
                }}
                onDragLeave={() =>
                  setDragOverStatus((s) => (s === status ? null : s))
                }
                onDrop={(e) => {
                  e.preventDefault();
                  const leadId = e.dataTransfer.getData("text/plain");
                  if (leadId) updateStatus(leadId, status);
                  setDragOverStatus(null);
                }}
                className={`rounded-lg bg-white p-3 shadow-sm transition ${
                  dragOverStatus === status ? "ring-2 ring-neutral-900" : ""
                }`}
              >
                <div className="mb-3 flex items-center justify-between px-1">
                  <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                    {STATUS_LABELS[status]}
                  </h2>
                  <span className="text-xs text-neutral-400">
                    {columnLeads.length}
                  </span>
                </div>

                <div className="space-y-2">
                  {columnLeads.length === 0 && (
                    <p className="px-1 py-6 text-center text-xs text-neutral-400">
                      Sem leads
                    </p>
                  )}

                  {columnLeads.map((lead) => {
                    const wa = whatsappUrl(lead.phone, lead.full_name);
                    const stale =
                      STALE_STATUSES.includes(lead.status) &&
                      daysSince(lead.updated_at) >= STALE_DAYS_THRESHOLD;
                    const duplicates = duplicatesOf(lead);
                    return (
                      <div
                        key={lead.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", lead.id);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onClick={() => setSelectedLeadId(lead.id)}
                        className={`cursor-grab rounded-md border border-neutral-200 p-3 transition active:cursor-grabbing ${
                          flashIds.has(lead.id)
                            ? "border-emerald-400 bg-emerald-50"
                            : "bg-neutral-50 hover:bg-neutral-100"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-neutral-900">
                            {lead.full_name || "Sem nome"}
                          </p>
                          {wa && (
                            <a
                              href={wa}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              title="Conversar no WhatsApp"
                              className="shrink-0 rounded-full bg-emerald-500 p-1.5 text-white hover:bg-emerald-600"
                            >
                              <WhatsAppIcon />
                            </a>
                          )}
                        </div>
                        {lead.phone && (
                          <p className="text-xs text-neutral-500">{lead.phone}</p>
                        )}
                        {lead.city && (
                          <p className="truncate text-xs text-neutral-500">
                            {lead.city}
                            {lead.category ? ` · ${lead.category}` : ""}
                          </p>
                        )}
                        <p className="mt-1 text-[10px] uppercase tracking-wide text-neutral-400">
                          {lead.source} · {formatDate(lead.created_at)}
                        </p>
                        {lead.monthly_value !== null && (
                          <p className="text-xs font-medium text-emerald-700">
                            {formatCurrency(lead.monthly_value)}/mês
                          </p>
                        )}
                        <div className="mt-1 flex flex-wrap gap-1">
                          {lead.meeting_datetime && (
                            <span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                              Reunião {formatDate(lead.meeting_datetime)}
                            </span>
                          )}
                          {lead.next_followup && (
                            <span className="inline-block rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                              Follow-up {new Date(`${lead.next_followup}T00:00:00`).toLocaleDateString("pt-BR")}
                            </span>
                          )}
                          {stale && (
                            <span className="inline-block rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-700">
                              Sem contato há {daysSince(lead.updated_at)}d
                            </span>
                          )}
                          {duplicates.length > 0 && (
                            <span
                              title={`Possível duplicata: ${duplicates
                                .map((d) => d.full_name || "sem nome")
                                .join(", ")}`}
                              className="inline-block rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700"
                            >
                              Possível duplicata
                            </span>
                          )}
                        </div>

                        <select
                          value={lead.status}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) =>
                            updateStatus(lead.id, e.target.value as LeadStatus)
                          }
                          className="mt-2 w-full rounded border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-700"
                        >
                          {STATUS_ORDER.map((s) => (
                            <option key={s} value={s}>
                              {STATUS_LABELS[s]}
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

      {selectedLead && (
        <LeadDetailModal
          lead={selectedLead}
          duplicateLeads={duplicatesOf(selectedLead)}
          onClose={() => setSelectedLeadId(null)}
          onUpdateStatus={updateStatus}
          onSaveNotes={saveNotes}
          onSaveMeeting={saveMeeting}
          onSaveMonthlyValue={saveMonthlyValue}
          onSaveNextFollowup={saveNextFollowup}
        />
      )}

      {showNewLeadModal && (
        <NewLeadModal onClose={() => setShowNewLeadModal(false)} onCreate={createLead} />
      )}
    </div>
  );
}
