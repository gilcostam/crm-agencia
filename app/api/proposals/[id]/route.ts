import { NextRequest, NextResponse } from "next/server";
import { hasValidSession } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { ProposalStatus } from "@/lib/types";

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
    .from("proposals")
    .select("*, client:clients(id, full_name, phone, email)")
    .eq("id", id)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }

  return NextResponse.json({ proposal: data });
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
    client_id,
    lead_id,
    title,
    status,
    service_type,
    value,
    recurring,
    sent_at,
    valid_until,
    contract_signed_at,
    contract_file_url,
    notes,
  } = body as {
    client_id?: string | null;
    lead_id?: string | null;
    title?: string;
    status?: ProposalStatus;
    service_type?: string;
    value?: number | string | null;
    recurring?: boolean;
    sent_at?: string | null;
    valid_until?: string | null;
    contract_signed_at?: string | null;
    contract_file_url?: string;
    notes?: string;
  };

  const update: Record<string, unknown> = {};

  if (client_id !== undefined) update.client_id = client_id || null;
  if (lead_id !== undefined) update.lead_id = lead_id || null;
  if (status !== undefined) update.status = status;
  if (title !== undefined) {
    const trimmed = title.trim();
    if (!trimmed) {
      return NextResponse.json({ error: "Título da proposta é obrigatório" }, { status: 400 });
    }
    update.title = trimmed;
  }
  if (service_type !== undefined) update.service_type = service_type?.trim() || null;
  if (value !== undefined) {
    const parsed = value !== null && String(value).trim() !== "" ? Number(value) : null;
    update.value = parsed !== null && !Number.isNaN(parsed) ? parsed : null;
  }
  if (recurring !== undefined) update.recurring = recurring;
  if (sent_at !== undefined) update.sent_at = sent_at || null;
  if (valid_until !== undefined) update.valid_until = valid_until || null;
  if (contract_signed_at !== undefined) update.contract_signed_at = contract_signed_at || null;
  if (contract_file_url !== undefined) update.contract_file_url = contract_file_url?.trim() || null;
  if (notes !== undefined) update.notes = notes?.trim() || null;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("proposals")
    .update(update)
    .eq("id", id)
    .select("*, client:clients(id, full_name, phone, email)")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ proposal: data });
}
