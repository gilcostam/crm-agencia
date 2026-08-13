import { NextRequest, NextResponse } from "next/server";
import { hasValidSession } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { ClientStatus } from "@/lib/types";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await hasValidSession())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const supabase = createServiceClient();

  const { data: client, error } = await supabase
    .from("clients")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }

  const { data: proposals, error: proposalsError } = await supabase
    .from("proposals")
    .select("*")
    .eq("client_id", id)
    .order("created_at", { ascending: false });

  if (proposalsError) {
    return NextResponse.json({ error: proposalsError.message }, { status: 500 });
  }

  return NextResponse.json({ client, proposals: proposals ?? [] });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await hasValidSession())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const {
    full_name,
    email,
    phone,
    document,
    category,
    city,
    monthly_value,
    status,
    notes,
    contract_start_date,
    contract_end_date,
  } = body as {
    full_name?: string;
    email?: string;
    phone?: string;
    document?: string;
    category?: string;
    city?: string;
    monthly_value?: number | string | null;
    status?: ClientStatus;
    notes?: string;
    contract_start_date?: string | null;
    contract_end_date?: string | null;
  };

  const update: Record<string, unknown> = {};

  if (full_name !== undefined) {
    const name = full_name.trim();
    if (!name) {
      return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 });
    }
    update.full_name = name;
  }
  if (email !== undefined) update.email = email.trim() || null;
  if (phone !== undefined) update.phone = phone.trim() || null;
  if (document !== undefined) update.document = document.trim() || null;
  if (category !== undefined) update.category = category?.trim() || null;
  if (city !== undefined) update.city = city.trim() || null;
  if (status !== undefined) update.status = status;
  if (notes !== undefined) update.notes = notes.trim() || null;
  if (monthly_value !== undefined) {
    const parsed =
      monthly_value !== null && String(monthly_value).trim() !== "" ? Number(monthly_value) : null;
    update.monthly_value = parsed !== null && !Number.isNaN(parsed) ? parsed : null;
  }
  if (contract_start_date !== undefined) {
    update.contract_start_date = contract_start_date?.trim() || null;
  }
  if (contract_end_date !== undefined) {
    update.contract_end_date = contract_end_date?.trim() || null;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("clients")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ client: data });
}
