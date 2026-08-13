import { NextRequest, NextResponse } from "next/server";
import { hasValidSession } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { TaskCategory, TaskRecurrence, TaskStatus } from "@/lib/types";

const VALID_CATEGORIES: TaskCategory[] = ["seo_local", "avaliacoes", "fotos", "pendencias", "outro"];
const VALID_RECURRENCES: TaskRecurrence[] = ["semanal", "mensal", "continuo"];
const VALID_STATUSES: TaskStatus[] = ["pendente", "em_andamento", "concluida", "cancelada"];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  if (!(await hasValidSession())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id, taskId } = await params;
  const body = await request.json().catch(() => ({}));
  const { title, description, category, responsible, due_date, recurrence, status } = body as {
    title?: string;
    description?: string | null;
    category?: TaskCategory;
    responsible?: string | null;
    due_date?: string | null;
    recurrence?: TaskRecurrence | null;
    status?: TaskStatus;
  };

  const update: Record<string, unknown> = {};

  if (title !== undefined) {
    if (!title.trim()) {
      return NextResponse.json({ error: "Título é obrigatório" }, { status: 400 });
    }
    update.title = title.trim();
  }
  if (description !== undefined) update.description = description?.trim() || null;
  if (category !== undefined) {
    if (!VALID_CATEGORIES.includes(category)) {
      return NextResponse.json({ error: "Categoria inválida" }, { status: 400 });
    }
    update.category = category;
  }
  if (responsible !== undefined) update.responsible = responsible?.trim() || null;
  if (due_date !== undefined) update.due_date = due_date || null;
  if (recurrence !== undefined) {
    if (recurrence && !VALID_RECURRENCES.includes(recurrence)) {
      return NextResponse.json({ error: "Recorrência inválida" }, { status: 400 });
    }
    update.recurrence = recurrence || null;
  }
  if (status !== undefined) {
    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: "Status inválido" }, { status: 400 });
    }
    update.status = status;
    // Registra quando a tarefa foi concluída (alimenta a linha do tempo de
    // execução no painel do cliente) e limpa se ela sair de 'concluida' de
    // novo (ex.: usuário desmarcou o checkbox por engano).
    update.completed_at = status === "concluida" ? new Date().toISOString() : null;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("client_tasks")
    .update(update)
    .eq("id", taskId)
    .eq("client_id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ task: data });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  if (!(await hasValidSession())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id, taskId } = await params;
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("client_tasks")
    .delete()
    .eq("id", taskId)
    .eq("client_id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
