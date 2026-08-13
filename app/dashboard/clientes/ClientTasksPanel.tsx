"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ClientTask,
  ParsedClientTask,
  TASK_CATEGORY_LABELS,
  TASK_RECURRENCE_LABELS,
  TaskCategory,
  TaskRecurrence,
} from "@/lib/types";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("pt-BR");
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const CATEGORY_OPTIONS = Object.keys(TASK_CATEGORY_LABELS) as TaskCategory[];
const RECURRENCE_OPTIONS = Object.keys(TASK_RECURRENCE_LABELS) as TaskRecurrence[];

const EMPTY_MANUAL_TASK = {
  title: "",
  responsible: "",
  due_date: "",
  category: "outro" as TaskCategory,
  recurrence: "" as TaskRecurrence | "",
};

interface TaskStats {
  total: number;
  done: number;
  overdue: number;
  upcoming: number;
  percent: number;
}

function computeTaskStats(tasks: ClientTask[]): TaskStats {
  // Tarefas canceladas saem do denominador — não representam trabalho
  // planejado que ainda precisa (ou precisava) ser feito.
  const relevant = tasks.filter((t) => t.status !== "cancelada");
  const total = relevant.length;
  const done = relevant.filter((t) => t.status === "concluida").length;
  const today = todayISO();
  const overdue = relevant.filter(
    (t) => t.status !== "concluida" && t.due_date !== null && t.due_date < today
  ).length;
  const upcoming = total - done - overdue;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return { total, done, overdue, upcoming, percent };
}

/** Barra de progresso gráfica com segmentos empilhados: concluídas (verde),
 * atrasadas (vermelho) e em dia/sem prazo (cinza) — dá pra ver de relance se
 * a rotina de trabalho do cliente está em dia ou atrasada. */
function TaskProgressBar({ stats }: { stats: TaskStats }) {
  if (stats.total === 0) return null;
  const donePct = (stats.done / stats.total) * 100;
  const overduePct = (stats.overdue / stats.total) * 100;
  const upcomingPct = (stats.upcoming / stats.total) * 100;

  return (
    <div className="mb-3 rounded-md border border-neutral-200 bg-neutral-50 p-3">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
        <span className="font-medium text-neutral-700">
          {stats.done}/{stats.total} tarefas concluídas ({stats.percent}%)
        </span>
        {stats.overdue > 0 ? (
          <span className="font-medium text-red-600">
            {stats.overdue} atrasada{stats.overdue > 1 ? "s" : ""}
          </span>
        ) : (
          <span className="font-medium text-emerald-600">Em dia</span>
        )}
      </div>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-neutral-200">
        {donePct > 0 && (
          <div className="h-full bg-emerald-500" style={{ width: `${donePct}%` }} title="Concluídas" />
        )}
        {overduePct > 0 && (
          <div className="h-full bg-red-500" style={{ width: `${overduePct}%` }} title="Atrasadas" />
        )}
        {upcomingPct > 0 && (
          <div className="h-full bg-neutral-400" style={{ width: `${upcomingPct}%` }} title="Em dia / sem prazo" />
        )}
      </div>
    </div>
  );
}

export default function ClientTasksPanel({ clientId }: { clientId: string }) {
  const [tasks, setTasks] = useState<ClientTask[] | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [manualTask, setManualTask] = useState(EMPTY_MANUAL_TASK);
  const [saving, setSaving] = useState(false);

  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importWarning, setImportWarning] = useState<string | null>(null);
  const [preview, setPreview] = useState<ParsedClientTask[] | null>(null);
  const [sourceDocument, setSourceDocument] = useState<string | null>(null);
  const [anchorDate, setAnchorDate] = useState(todayISO());
  const [confirming, setConfirming] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const stats = useMemo(() => computeTaskStats(tasks ?? []), [tasks]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/clients/${clientId}/tasks`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setTasks(data.tasks ?? []);
      })
      .catch(() => {
        if (!cancelled) setTasks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  async function toggleDone(task: ClientTask) {
    const nextStatus = task.status === "concluida" ? "pendente" : "concluida";
    setTasks((prev) => prev?.map((t) => (t.id === task.id ? { ...t, status: nextStatus } : t)) ?? prev);
    const res = await fetch(`/api/clients/${clientId}/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
    if (!res.ok) {
      setTasks((prev) => prev?.map((t) => (t.id === task.id ? { ...t, status: task.status } : t)) ?? prev);
    }
  }

  async function deleteTask(task: ClientTask) {
    if (!confirm(`Excluir a tarefa "${task.title}"?`)) return;
    const prev = tasks;
    setTasks((ts) => ts?.filter((t) => t.id !== task.id) ?? ts);
    const res = await fetch(`/api/clients/${clientId}/tasks/${task.id}`, { method: "DELETE" });
    if (!res.ok) setTasks(prev);
  }

  async function handleAddManual(e: React.FormEvent) {
    e.preventDefault();
    if (!manualTask.title.trim()) return;
    setSaving(true);
    const res = await fetch(`/api/clients/${clientId}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: manualTask.title,
        responsible: manualTask.responsible || null,
        due_date: manualTask.due_date || null,
        category: manualTask.category,
        recurrence: manualTask.recurrence || null,
      }),
    });
    const data = await res.json();
    setSaving(false);
    if (res.ok) {
      setTasks((prev) => [...(prev ?? []), data.task]);
      setManualTask(EMPTY_MANUAL_TASK);
      setShowAddForm(false);
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportError(null);
    setImportWarning(null);
    setPreview(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("anchor_date", anchorDate);

    try {
      const res = await fetch(`/api/clients/${clientId}/tasks/import`, {
        method: "POST",
        body: formData,
      });
      // A resposta pode não ser JSON válido em caso de erro inesperado do
      // servidor (ex.: crash antes de conseguir montar um NextResponse.json) —
      // sem isso, res.json() lança e o catch abaixo nunca chega a rodar
      // setImporting(false), deixando o botão travado em "Lendo PDF..." pra
      // sempre.
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        setImportError(data?.error ?? "Erro ao ler o documento. Tente novamente.");
        return;
      }
      if (data.warning) setImportWarning(data.warning);
      setPreview(data.tasks ?? []);
      setSourceDocument(data.source_document ?? file.name);
    } catch {
      setImportError("Erro de conexão ao enviar o documento. Tente novamente.");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function updatePreviewTask(index: number, patch: Partial<ParsedClientTask>) {
    setPreview((prev) => (prev ? prev.map((t, i) => (i === index ? { ...t, ...patch } : t)) : prev));
  }

  function removePreviewTask(index: number) {
    setPreview((prev) => (prev ? prev.filter((_, i) => i !== index) : prev));
  }

  async function confirmImport() {
    if (!preview || preview.length === 0) return;
    setConfirming(true);
    const res = await fetch(`/api/clients/${clientId}/tasks/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tasks: preview, source_document: sourceDocument }),
    });
    const data = await res.json();
    setConfirming(false);
    if (res.ok) {
      setTasks((prev) => [...(prev ?? []), ...(data.tasks ?? [])]);
      setPreview(null);
      setSourceDocument(null);
      setImportWarning(null);
    } else {
      setImportError(data.error ?? "Erro ao importar tarefas");
    }
  }

  return (
    <div className="mt-5 border-t border-neutral-200 pt-4">
      <TaskProgressBar stats={stats} />

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Rotina de trabalho</p>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={anchorDate}
            onChange={(e) => setAnchorDate(e.target.value)}
            title="Data-âncora para calcular prazos relativos (ex.: '7 dias') ao importar um documento"
            className="rounded border border-neutral-200 bg-white px-1.5 py-1 text-xs text-neutral-600"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100 disabled:opacity-50"
          >
            {importing ? "Lendo PDF..." : "Importar plano (PDF)"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={handleFileChange}
          />
          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            className="rounded-md bg-neutral-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-neutral-700"
          >
            + Tarefa
          </button>
        </div>
      </div>

      {importError && <p className="mb-2 text-xs text-red-600">{importError}</p>}
      {importWarning && <p className="mb-2 text-xs text-amber-600">{importWarning}</p>}

      {preview && preview.length > 0 && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3">
          <p className="mb-2 text-xs font-medium text-amber-800">
            {preview.length} tarefa(s) identificada(s) em &ldquo;{sourceDocument}&rdquo; — revise antes de confirmar:
          </p>
          <ul className="space-y-2">
            {preview.map((t, i) => (
              <li key={i} className="rounded border border-amber-100 bg-white p-2 text-xs">
                <div className="flex items-start gap-2">
                  <input
                    type="text"
                    value={t.title}
                    onChange={(e) => updatePreviewTask(i, { title: e.target.value })}
                    className="min-w-0 flex-1 rounded border border-neutral-200 px-1.5 py-1 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => removePreviewTask(i)}
                    className="shrink-0 text-neutral-400 hover:text-red-600"
                    aria-label="Remover"
                  >
                    ✕
                  </button>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <input
                    type="text"
                    placeholder="Responsável"
                    value={t.responsible ?? ""}
                    onChange={(e) => updatePreviewTask(i, { responsible: e.target.value || null })}
                    className="w-28 rounded border border-neutral-200 px-1.5 py-1 text-xs"
                  />
                  <input
                    type="date"
                    value={t.due_date ?? ""}
                    onChange={(e) => updatePreviewTask(i, { due_date: e.target.value || null })}
                    className="rounded border border-neutral-200 px-1.5 py-1 text-xs"
                  />
                  <select
                    value={t.category}
                    onChange={(e) => updatePreviewTask(i, { category: e.target.value as TaskCategory })}
                    className="rounded border border-neutral-200 px-1.5 py-1 text-xs"
                  >
                    {CATEGORY_OPTIONS.map((c) => (
                      <option key={c} value={c}>
                        {TASK_CATEGORY_LABELS[c]}
                      </option>
                    ))}
                  </select>
                  <select
                    value={t.recurrence ?? ""}
                    onChange={(e) =>
                      updatePreviewTask(i, { recurrence: (e.target.value || null) as TaskRecurrence | null })
                    }
                    className="rounded border border-neutral-200 px-1.5 py-1 text-xs"
                  >
                    <option value="">Sem recorrência</option>
                    {RECURRENCE_OPTIONS.map((r) => (
                      <option key={r} value={r}>
                        {TASK_RECURRENCE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setPreview(null);
                setSourceDocument(null);
              }}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100"
            >
              Descartar
            </button>
            <button
              type="button"
              disabled={confirming}
              onClick={confirmImport}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
            >
              {confirming ? "Importando..." : `Confirmar importação (${preview.length})`}
            </button>
          </div>
        </div>
      )}

      {showAddForm && (
        <form onSubmit={handleAddManual} className="mb-3 rounded-md border border-neutral-200 bg-neutral-50 p-3">
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              placeholder="Título da tarefa *"
              required
              autoFocus
              value={manualTask.title}
              onChange={(e) => setManualTask((v) => ({ ...v, title: e.target.value }))}
              className="min-w-[180px] flex-1 rounded border border-neutral-200 bg-white px-2 py-1.5 text-xs"
            />
            <input
              type="text"
              placeholder="Responsável"
              value={manualTask.responsible}
              onChange={(e) => setManualTask((v) => ({ ...v, responsible: e.target.value }))}
              className="w-32 rounded border border-neutral-200 bg-white px-2 py-1.5 text-xs"
            />
            <input
              type="date"
              value={manualTask.due_date}
              onChange={(e) => setManualTask((v) => ({ ...v, due_date: e.target.value }))}
              className="rounded border border-neutral-200 bg-white px-2 py-1.5 text-xs"
            />
            <select
              value={manualTask.category}
              onChange={(e) => setManualTask((v) => ({ ...v, category: e.target.value as TaskCategory }))}
              className="rounded border border-neutral-200 bg-white px-2 py-1.5 text-xs"
            >
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {TASK_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
            <select
              value={manualTask.recurrence}
              onChange={(e) =>
                setManualTask((v) => ({ ...v, recurrence: e.target.value as TaskRecurrence | "" }))
              }
              className="rounded border border-neutral-200 bg-white px-2 py-1.5 text-xs"
            >
              <option value="">Sem recorrência</option>
              {RECURRENCE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {TASK_RECURRENCE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
            >
              {saving ? "Salvando..." : "Adicionar"}
            </button>
          </div>
        </form>
      )}

      {tasks === null ? (
        <p className="text-sm text-neutral-400">Carregando...</p>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-neutral-400">Nenhuma tarefa cadastrada ainda.</p>
      ) : (
        <ul className="space-y-1.5">
          {tasks
            .slice()
            .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"))
            .map((t) => (
              <li
                key={t.id}
                className="flex items-center gap-2 rounded-md border border-neutral-200 px-3 py-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={t.status === "concluida"}
                  onChange={() => toggleDone(t)}
                  className="shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className={t.status === "concluida" ? "text-neutral-400 line-through" : "text-neutral-800"}>
                    {t.title}
                  </p>
                  <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-neutral-400">
                    <span className="rounded bg-neutral-100 px-1.5 py-0.5">
                      {TASK_CATEGORY_LABELS[t.category]}
                    </span>
                    {t.recurrence && (
                      <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">
                        {TASK_RECURRENCE_LABELS[t.recurrence]}
                      </span>
                    )}
                    {t.responsible && <span>{t.responsible}</span>}
                  </p>
                </div>
                <span
                  className={`shrink-0 text-xs ${
                    t.status !== "concluida" && t.due_date !== null && t.due_date < todayISO()
                      ? "font-medium text-red-600"
                      : "text-neutral-400"
                  }`}
                >
                  {formatDate(t.due_date)}
                </span>
                <button
                  type="button"
                  onClick={() => deleteTask(t)}
                  className="shrink-0 text-neutral-300 hover:text-red-600"
                  aria-label="Excluir tarefa"
                >
                  ✕
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
