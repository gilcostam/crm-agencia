"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ClientTask,
  TASK_CATEGORY_LABELS,
  TASK_RECURRENCE_LABELS,
  TaskStatus,
} from "@/lib/types";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  // due_date é "date" puro (yyyy-mm-dd) — construir sem timezone pra não
  // "voltar um dia" perto da meia-noite.
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("pt-BR");
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type Bucket = "atrasadas" | "hoje" | "proximos7" | "depois" | "recorrentes" | "concluidas";

function bucketOf(task: ClientTask): Bucket {
  if (task.status === "concluida" || task.status === "cancelada") return "concluidas";
  if (!task.due_date) return "recorrentes";
  const today = todayISO();
  if (task.due_date < today) return "atrasadas";
  if (task.due_date === today) return "hoje";
  const in7 = new Date();
  in7.setDate(in7.getDate() + 7);
  const in7ISO = `${in7.getFullYear()}-${String(in7.getMonth() + 1).padStart(2, "0")}-${String(in7.getDate()).padStart(2, "0")}`;
  if (task.due_date <= in7ISO) return "proximos7";
  return "depois";
}

const BUCKET_LABELS: Record<Bucket, string> = {
  atrasadas: "Atrasadas",
  hoje: "Hoje",
  proximos7: "Próximos 7 dias",
  depois: "Mais adiante",
  recorrentes: "Recorrentes / sem prazo",
  concluidas: "Concluídas / canceladas",
};

const BUCKET_ORDER: Bucket[] = ["atrasadas", "hoje", "proximos7", "depois", "recorrentes", "concluidas"];

export default function TarefasClient({ initialTasks }: { initialTasks: ClientTask[] }) {
  const [tasks, setTasks] = useState<ClientTask[]>(initialTasks);
  const [responsibleFilter, setResponsibleFilter] = useState("all");
  const [clientFilter, setClientFilter] = useState("all");
  const [showDone, setShowDone] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const responsibles = useMemo(() => {
    const set = new Set<string>();
    tasks.forEach((t) => t.responsible && set.add(t.responsible));
    return Array.from(set).sort();
  }, [tasks]);

  const clientOptions = useMemo(() => {
    const map = new Map<string, string>();
    tasks.forEach((t) => t.client && map.set(t.client.id, t.client.full_name));
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [tasks]);

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (responsibleFilter !== "all" && t.responsible !== responsibleFilter) return false;
      if (clientFilter !== "all" && t.client_id !== clientFilter) return false;
      return true;
    });
  }, [tasks, responsibleFilter, clientFilter]);

  const grouped = useMemo(() => {
    const groups: Record<Bucket, ClientTask[]> = {
      atrasadas: [],
      hoje: [],
      proximos7: [],
      depois: [],
      recorrentes: [],
      concluidas: [],
    };
    for (const t of filtered) groups[bucketOf(t)].push(t);
    return groups;
  }, [filtered]);

  async function toggleDone(task: ClientTask) {
    const nextStatus: TaskStatus = task.status === "concluida" ? "pendente" : "concluida";
    setBusyId(task.id);
    const prev = tasks;
    setTasks((ts) => ts.map((t) => (t.id === task.id ? { ...t, status: nextStatus } : t)));
    const res = await fetch(`/api/clients/${task.client_id}/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
    if (!res.ok) setTasks(prev);
    setBusyId(null);
  }

  return (
    <div className="min-h-screen bg-neutral-100">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <div>
            <h1 className="font-serif text-2xl text-neutral-900">Tarefas</h1>
            <p className="mt-0.5 text-xs text-neutral-400">
              Rotina de trabalho de todos os clientes, num só lugar
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <select
            value={responsibleFilter}
            onChange={(e) => setResponsibleFilter(e.target.value)}
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-700"
          >
            <option value="all">Todos os responsáveis</option>
            {responsibles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <select
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-700"
          >
            <option value="all">Todos os clientes</option>
            {clientOptions.map(([cid, name]) => (
              <option key={cid} value={cid}>
                {name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-neutral-500">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
            Mostrar concluídas/canceladas
          </label>
        </div>

        {filtered.length === 0 ? (
          <p className="rounded-md border border-dashed border-neutral-300 bg-white px-4 py-8 text-center text-sm text-neutral-400">
            Nenhuma tarefa cadastrada ainda. Abra um cliente e importe um plano ou adicione tarefas manualmente.
          </p>
        ) : (
          <div className="space-y-6">
            {BUCKET_ORDER.filter((b) => b !== "concluidas" || showDone).map((bucket) => {
              const items = grouped[bucket];
              if (items.length === 0) return null;
              return (
                <section key={bucket}>
                  <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
                    {BUCKET_LABELS[bucket]} · {items.length}
                  </h2>
                  <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
                    <ul className="divide-y divide-neutral-100">
                      {items.map((t) => (
                        <li key={t.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                          <input
                            type="checkbox"
                            checked={t.status === "concluida"}
                            disabled={busyId === t.id}
                            onChange={() => toggleDone(t)}
                            className="shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <p
                              className={`truncate font-medium ${
                                t.status === "concluida" ? "text-neutral-400 line-through" : "text-neutral-800"
                              }`}
                            >
                              {t.title}
                            </p>
                            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-neutral-400">
                              {t.client && (
                                <Link
                                  href={`/dashboard/clientes?cliente=${t.client.id}`}
                                  className="text-neutral-600 hover:underline"
                                >
                                  {t.client.full_name}
                                </Link>
                              )}
                              <span className="rounded bg-neutral-100 px-1.5 py-0.5">
                                {TASK_CATEGORY_LABELS[t.category]}
                              </span>
                              {t.recurrence && (
                                <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">
                                  {TASK_RECURRENCE_LABELS[t.recurrence]}
                                </span>
                              )}
                            </p>
                          </div>
                          {t.responsible && (
                            <span className="shrink-0 rounded-full bg-neutral-900 px-2.5 py-1 text-xs font-medium text-white">
                              {t.responsible}
                            </span>
                          )}
                          <span className="w-20 shrink-0 text-right text-xs text-neutral-400">
                            {formatDate(t.due_date)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
