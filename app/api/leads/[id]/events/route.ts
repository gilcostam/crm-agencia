import { NextRequest, NextResponse } from "next/server";
import { hasValidSession } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

/** Tipos de evento que uma ação manual do usuário no dashboard pode
 * registrar diretamente (ao contrário de "status_change"/"created"/etc, que
 * só o próprio backend gera como efeito colateral de outras rotas). Mantido
 * restrito de propósito — não é um endpoint genérico de escrita em
 * lead_events. */
const ALLOWED_MANUAL_EVENT_TYPES = new Set(["note"]);

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await hasValidSession())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const { type, message } = body as { type?: string; message?: string };

  if (!type || !ALLOWED_MANUAL_EVENT_TYPES.has(type)) {
    return NextResponse.json({ error: "type inválido" }, { status: 400 });
  }
  const messageTrimmed = (message ?? "").trim();
  if (!messageTrimmed) {
    return NextResponse.json({ error: "message é obrigatório" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("lead_events")
    .insert({ lead_id: id, type, message: messageTrimmed })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ event: data }, { status: 201 });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await hasValidSession())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("lead_events")
    .select("*")
    .eq("lead_id", id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ events: data });
}
