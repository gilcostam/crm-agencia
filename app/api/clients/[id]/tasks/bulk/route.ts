import { NextRequest, NextResponse } from "next/server";
import { hasValidSession } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { TaskCategory, TaskRecurrence } from "@/lib/types";

const VALID_CATEGORIES: TaskCategory[] = ["seo_local", "avaliacoes", "fotos", "pendencias", "outro"];
const VALID_RECURRENCES: TaskRecurrence[] = ["semanal", "mensal", "continuo"];

interface BulkTaskInput {
  title?: string;
  description?: string | null;
  category?: TaskCategory;
  responsible?: string | null;
  due_date?: string | null;
  recurrence?: TaskRecurrence | null;
}

/**
 * Confirma a importação: recebe a lista de tarefas (já revisadas/editadas
 * pelo usuário na tela de preview) e grava todas de uma vez, associadas ao
 * documento de origem.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await hasValidSession())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const { tasks, source_document } = body as {
    tasks?: BulkTaskInput[];
    source_document?: string | null;
  };

  if (!Array.isArray(tasks) || tasks.length === 0) {
    return NextResponse.json({ error: "Nenhuma tarefa para importar" }, { status: 400 });
  }
  if (tasks.length > 200) {
    return NextResponse.json({ error: "Muitas tarefas de uma vez (máximo 200)" }, { status: 400 });
  }

  const rows = [];
  for (const t of tasks) {
    if (!t.title?.trim()) {
      return NextResponse.json({ error: "Toda tarefa precisa de um título" }, { status: 400 });
    }
    if (t.category && !VALID_CATEGORIES.includes(t.category)) {
      return NextResponse.json({ error: `Categoria inválida: ${t.category}` }, { status: 400 });
    }
    if (t.recurrence && !VALID_RECURRENCES.includes(t.recurrence)) {
      return NextResponse.json({ error: `Recorrência inválida: ${t.recurrence}` }, { status: 400 });
    }
    rows.push({
      client_id: id,
      title: t.title.trim(),
      description: t.description?.trim() || null,
      category: t.category ?? "outro",
      responsible: t.responsible?.trim() || null,
      due_date: t.due_date || null,
      recurrence: t.recurrence || null,
      status: "pendente" as const,
      source_document: source_document?.trim() || null,
    });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.from("client_tasks").insert(rows).select();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ tasks: data ?? [] });
}
