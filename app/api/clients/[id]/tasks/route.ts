import { NextRequest, NextResponse } from "next/server";
import { hasValidSession } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { TaskCategory, TaskRecurrence, TaskStatus } from "@/lib/types";

const VALID_CATEGORIES: TaskCategory[] = ["seo_local", "avaliacoes", "fotos", "pendencias", "outro"];
const VALID_RECURRENCES: TaskRecurrence[] = ["semanal", "mensal", "continuo"];
const VALID_STATUSES: TaskStatus[] = ["pendente", "em_andamento", "concluida", "cancelada"];

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await hasValidSession())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("client_tasks")
    .select("*")
    .eq("client_id", id)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ tasks: data ?? [] });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await hasValidSession())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const {
    title,
    description,
    category,
    responsible,
    due_date,
    recurrence,
    status,
    source_document,
  } = body as {
    title?: string;
    description?: string | null;
    category?: TaskCategory;
    responsible?: string | null;
    due_date?: string | null;
    recurrence?: TaskRecurrence | null;
    status?: TaskStatus;
    source_document?: string | null;
  };

  if (!title?.trim()) {
    return NextResponse.json({ error: "Título é obrigatório" }, { status: 400 });
  }
  if (category && !VALID_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: "Categoria inválida" }, { status: 400 });
  }
  if (recurrence && !VALID_RECURRENCES.includes(recurrence)) {
    return NextResponse.json({ error: "Recorrência inválida" }, { status: 400 });
  }
  if (status && !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Status inválido" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("client_tasks")
    .insert({
      client_id: id,
      title: title.trim(),
      description: description?.trim() || null,
      category: category ?? "outro",
      responsible: responsible?.trim() || null,
      due_date: due_date || null,
      recurrence: recurrence || null,
      status: status ?? "pendente",
      source_document: source_document?.trim() || null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ task: data });
}
