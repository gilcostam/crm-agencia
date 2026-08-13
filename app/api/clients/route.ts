import { NextRequest, NextResponse } from "next/server";
import { hasValidSession } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { ClientStatus } from "@/lib/types";

export async function GET() {
  if (!(await hasValidSession())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .order("full_name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ clients: data });
}

export async function POST(request: NextRequest) {
  if (!(await hasValidSession())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

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
    source_lead_id,
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
    source_lead_id?: string;
    contract_start_date?: string | null;
    contract_end_date?: string | null;
  };

  const name = (full_name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 });
  }

  const parsedMonthlyValue =
    monthly_value !== undefined && monthly_value !== null && String(monthly_value).trim() !== ""
      ? Number(monthly_value)
      : null;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("clients")
    .insert({
      full_name: name,
      email: email?.trim() || null,
      phone: phone?.trim() || null,
      document: document?.trim() || null,
      category: category?.trim() || null,
      city: city?.trim() || null,
      monthly_value:
        parsedMonthlyValue !== null && !Number.isNaN(parsedMonthlyValue) ? parsedMonthlyValue : null,
      status: status ?? "ativo",
      notes: notes?.trim() || null,
      source_lead_id: source_lead_id || null,
      contract_start_date: contract_start_date?.trim() || null,
      contract_end_date: contract_end_date?.trim() || null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ client: data }, { status: 201 });
}
