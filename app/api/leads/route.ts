import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { hasValidSession, isValidSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { LeadStatus, STATUS_ORDER } from "@/lib/types";
import { buildStatusChangeUpdate } from "@/lib/lead-status";

/** Usado pelo polling do dashboard (app/dashboard/dashboard-client.tsx) pra
 * manter cada tela restrita ao mesmo recorte de leads que o server component
 * carregou inicialmente: `?source=a,b` inclui só esses `source`, `?excludeSource=a,b`
 * exclui esses `source` (mutuamente exclusivos — se os dois vierem, `source`
 * tem prioridade). Sem nenhum dos dois, retorna todos os leads (comportamento
 * de sempre). */
export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!isValidSessionToken(token)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const includeSource = searchParams.get("source");
  const excludeSource = searchParams.get("excludeSource");

  const supabase = createServiceClient();
  let query = supabase
    .from("leads")
    .select("*")
    .is("merged_into_lead_id", null);

  if (includeSource) {
    query = query.in("source", includeSource.split(","));
  } else if (excludeSource) {
    query = query.not("source", "in", `(${excludeSource.split(",").join(",")})`);
  }

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ leads: data });
}

/** Cadastro manual de lead (ex: contato recebido por telefone, indicação,
 * ou qualquer canal fora do Meta Ads / prospecção). */
export async function POST(request: NextRequest) {
  if (!(await hasValidSession())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { full_name, phone, email, city, category, notes, status, monthly_value } = body as {
    full_name?: string;
    phone?: string;
    email?: string;
    city?: string;
    category?: string;
    notes?: string;
    status?: string;
    monthly_value?: number | null;
  };

  const name = (full_name ?? "").trim();
  const phoneTrimmed = (phone ?? "").trim();
  const emailTrimmed = (email ?? "").trim();

  if (!name) {
    return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 });
  }
  if (!phoneTrimmed && !emailTrimmed) {
    return NextResponse.json(
      { error: "Informe pelo menos telefone ou e-mail" },
      { status: 400 }
    );
  }
  if (status !== undefined && !STATUS_ORDER.includes(status as (typeof STATUS_ORDER)[number])) {
    return NextResponse.json({ error: "status inválido" }, { status: 400 });
  }
  if (
    monthly_value !== undefined &&
    monthly_value !== null &&
    (typeof monthly_value !== "number" || Number.isNaN(monthly_value) || monthly_value < 0)
  ) {
    return NextResponse.json({ error: "monthly_value inválido" }, { status: 400 });
  }

  const supabase = createServiceClient();

  const initialStatus = (status ?? "novo_lead") as LeadStatus;
  // Se o cadastro manual já entra num status além de "Novo Lead" (ex.: uma
  // reunião que já tinha sido marcada por outro canal), registra a data
  // dessa transição em status_dates e aplica a mesma política de follow-up
  // automático (48h) usada pelas demais mudanças de status — ver
  // lib/lead-status.ts.
  const statusExtras: {
    status_dates?: Partial<Record<LeadStatus, string>>;
    next_followup?: string | null;
  } = initialStatus === "novo_lead" ? {} : buildStatusChangeUpdate({}, initialStatus);

  const { data, error } = await supabase
    .from("leads")
    .insert({
      full_name: name,
      phone: phoneTrimmed || null,
      email: emailTrimmed || null,
      city: city?.trim() || null,
      category: category?.trim() || null,
      status: initialStatus,
      source: "manual",
      notes: notes?.trim() || null,
      monthly_value: monthly_value ?? null,
      ...(statusExtras.status_dates ? { status_dates: statusExtras.status_dates } : {}),
      ...(statusExtras.next_followup !== undefined
        ? { next_followup: statusExtras.next_followup }
        : {}),
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { error: eventError } = await supabase.from("lead_events").insert({
    lead_id: data.id,
    type: "created",
    message: "Lead cadastrado manualmente",
  });
  if (eventError) {
    console.error("Erro ao registrar histórico do lead:", eventError.message);
  }

  return NextResponse.json({ lead: data }, { status: 201 });
}
