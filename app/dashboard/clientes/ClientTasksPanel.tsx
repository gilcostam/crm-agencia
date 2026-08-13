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

/** `completed_at` é um timestamp completo (não uma coluna "date" pura), então
 * dá pra usar o parsing normal do Date sem o cuidado de fuso-horário aplicado
 * em `formatDate`/`due_date` acima. */
function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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

/** Lista de tarefas completa, ordenada por prazo — usada dentro do painel
 * grande (`ClientTasksModal`). Cada linha tem checkbox de conclusão e botão
 * de excluir. */
function TaskList({
  tasks,
  onToggle,
  onDelete,
}: {
  tasks: ClientTask[];
  onToggle: (task: ClientTask) => void;
  onDelete: (task: ClientTask) => void;
}) {
  if (tasks.length === 0) {
    return <p className="text-sm text-neutral-400">Nenhuma tarefa cadastrada ainda.</p>;
  }
  return (
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
              onChange={() => onToggle(t)}
              className="shrink-0"
            />
            <div className="min-w-0 flex-1">
              <p className={t.status === "concluida" ? "text-neutral-400 line-through" : "text-neutral-800"}>
                {t.title}
              </p>
              <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-neutral-400">
                <span className="rounded bg-neutral-100 px-1.5 py-0.5">{TASK_CATEGORY_LABELS[t.category]}</span>
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
              onClick={() => onDelete(t)}
              className="shrink-0 text-neutral-300 hover:text-red-600"
              aria-label="Excluir tarefa"
            >
              ✕
            </button>
          </li>
        ))}
    </ul>
  );
}

/** Linha do tempo de execução: histórico das tarefas conforme foram
 * concluídas, da mais recente para a mais antiga — dá visibilidade de como o
 * trabalho avançou ao longo do tempo, não só do estado atual. */
function ExecutionTimeline({ tasks }: { tasks: ClientTask[] }) {
  const completed = useMemo(
    () =>
      tasks
        .filter((t) => t.status === "concluida" && t.completed_at !== null)
        .sort((a, b) => (b.completed_at as string).localeCompare(a.completed_at as string)),
    [tasks]
  );

  if (completed.length === 0) {
    return (
      <p className="text-sm text-neutral-400">
        Nenhuma tarefa concluída ainda — a linha do tempo aparece aqui conforme as tarefas forem marcadas
        como concluídas.
      </p>
    );
  }

  return (
    <ul className="space-y-3 border-l-2 border-emerald-200 pl-4">
      {completed.map((t) => (
        <li key={t.id} className="relative">
          <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500" />
          <p className="text-sm font-medium text-neutral-800">{t.title}</p>
          <p className="text-xs text-neutral-400">
            Concluída em {formatDateTime(t.completed_at)}
            {t.responsible ? ` · ${t.responsible}` : ""}
            {" · "}
            <span className="rounded bg-neutral-100 px-1.5 py-0.5">{TASK_CATEGORY_LABELS[t.category]}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}

/** Painel completo de tarefas — janela grande própria (não mais espremida
 * dentro do modal de detalhe do cliente), com os controles de importar/criar
 * tarefa, a lista completa e a linha do tempo de execução lado a lado com o
 * estado atual. */
function ClientTasksModal({
  clientId,
  clientName,
  tasks,
  stats,
  onClose,
  onToggle,
  onDelete,
  onTaskCreated,
  onTasksImported,
}: {
  clientId: string;
  clientName: string;
  tasks: ClientTask[];
  stats: TaskStats;
  onClose: () => void;
  onToggle: (task: ClientTask) => void;
  onDelete: (task: ClientTask) => void;
  onTaskCreated: (task: ClientTask) => void;
  onTasksImported: (tasks: ClientTask[]) => void;
}) {
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

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

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
      onTaskCreated(data.task);
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
      onTasksImported(data.tasks ?? []);
      setPreview(null);
      setSourceDocument(null);
      setImportWarning(null);
    } else {
      setImportError(data.error ?? "Erro ao importar tarefas");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-neutral-200 px-6 py-4">
          <div>
            <h3 className="font-serif text-xl text-neutral-900">Rotina de trabalho</h3>
            <p className="text-xs text-neutral-400">{clientName}</p>
          </div>
          <button
            onClick={onClose}
            className="text-lg leading-none text-neutral-400 hover:text-neutral-900"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-4">
          <TaskProgressBar stats={stats} />

          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Tarefas</p>
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
                {preview.length} tarefa(s) identificada(s) em &ldquo;{sourceDocument}&rdquo; — revise antes de
                confirmar:
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
                  onChange={(e) => setManualTask((v) => ({ ...v, recurrence: e.target.value as TaskRecurrence | "" }))}
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

          <TaskList tasks={tasks} onToggle={onToggle} onDelete={onDelete} />

          <div className="mt-6 border-t border-neutral-200 pt-4">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-400">
              Linha do tempo de execução
            </p>
            <ExecutionTimeline tasks={tasks} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ClientTasksPanel({
  clientId,
  clientName,
}: {
  clientId: string;
  clientName: string;
}) {
  const [tasks, setTasks] = useState<ClientTask[] | null>(null);
  const [showModal, setShowModal] = useState(false);

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
    const prevTasks = tasks;
    // Otimista: já reflete o novo status e uma estimativa de completed_at na
    // hora, e depois reconcilia com o valor exato devolvido pelo servidor
    // (usado pela linha do tempo de execução).
    setTasks(
      (prev) =>
        prev?.map((t) =>
          t.id === task.id
            ? { ...t, status: nextStatus, completed_at: nextStatus === "concluida" ? new Date().toISOString() : null }
            : t
        ) ?? prev
    );
    const res = await fetch(`/api/clients/${clientId}/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.task) {
        setTasks((prev) => prev?.map((t) => (t.id === task.id ? data.task : t)) ?? prev);
      }
    } else {
      setTasks(prevTasks);
    }
  }

  async function deleteTask(task: ClientTask) {
    if (!confirm(`Excluir a tarefa "${task.title}"?`)) return;
    const prev = tasks;
    setTasks((ts) => ts?.filter((t) => t.id !== task.id) ?? ts);
    const res = await fetch(`/api/clients/${clientId}/tasks/${task.id}`, { method: "DELETE" });
    if (!res.ok) setTasks(prev);
  }

  const nextUp = useMemo(
    () =>
      (tasks ?? [])
        .filter((t) => t.status !== "concluida" && t.status !== "cancelada")
        .slice()
        .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"))
        .slice(0, 3),
    [tasks]
  );

  return (
    <div className="mt-5 border-t border-neutral-200 pt-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Rotina de trabalho</p>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100"
        >
          Abrir painel completo →
        </button>
      </div>

      <TaskProgressBar stats={stats} />

      {tasks === null ? (
        <p className="text-sm text-neutral-400">Carregando...</p>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-neutral-400">
          Nenhuma tarefa cadastrada ainda. Abra o painel completo pra importar um plano ou criar a primeira.
        </p>
      ) : (
        <ul className="space-y-1">
          {nextUp.map((t) => (
            <li key={t.id} className="flex items-center gap-2 text-xs text-neutral-600">
              <input type="checkbox" checked={false} onChange={() => toggleDone(t)} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">{t.title}</span>
              <span
                className={
                  t.due_date !== null && t.due_date < todayISO() ? "shrink-0 font-medium text-red-600" : "shrink-0 text-neutral-400"
                }
              >
                {formatDate(t.due_date)}
              </span>
            </li>
          ))}
          {stats.total - stats.done > nextUp.length && (
            <li className="pt-0.5 text-xs text-neutral-400">
              +{stats.total - stats.done - nextUp.length} outra(s) pendente(s) — veja no painel completo.
            </li>
          )}
        </ul>
      )}

      {showModal && (
        // stopPropagation redundante aqui (o modal já nasce dentro do
        // conteúdo do ClientDetailModal, que já intercepta bubbling), mas
        // mantém o mesmo padrão defensivo usado no modal de "Editar dados".
        <div onClick={(e) => e.stopPropagation()}>
          <ClientTasksModal
            clientId={clientId}
            clientName={clientName}
            tasks={tasks ?? []}
            stats={stats}
            onClose={() => setShowModal(false)}
            onToggle={toggleDone}
            onDelete={deleteTask}
            onTaskCreated={(task) => setTasks((prev) => [...(prev ?? []), task])}
            onTasksImported={(imported) => setTasks((prev) => [...(prev ?? []), ...imported])}
          />
        </div>
      )}
    </div>
  );
}
