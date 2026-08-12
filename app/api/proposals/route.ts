import { NextRequest, NextResponse } from "next/server";
import { hasValidSession } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { ProposalStatus } from "@/lib/types";

export async function GET() {
  if (!(await hasValidSession())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("proposals")
    .select("*, client:clients(id, full_name, phone, email)")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ proposals: data });
}

export async function POST(request: NextRequest) {
  if (!(await hasValidSession())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

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
    client_id?: string;
    lead_id?: string;
    title?: string;
    status?: ProposalStatus;
    service_type?: string;
    value?: number | string;
    recurring?: boolean;
    sent_at?: string;
    valid_until?: string;
    contract_signed_at?: string;
    contract_file_url?: string;
    notes?: string;
  };

  const proposalTitle = (title ?? "").trim();
  if (!proposalTitle) {
    return NextResponse.json({ error: "Título da proposta é obrigatório" }, { status: 400 });
  }

  const parsedValue =
    value !== undefined && value !== null && String(value).trim() !== "" ? Number(value) : null;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("proposals")
    .insert({
      client_id: client_id || null,
      lead_id: lead_id || null,
      title: proposalTitle,
      status: status ?? "rascunho",
      service_type: service_type?.trim() || null,
      value: parsedValue !== null && !Number.isNaN(parsedValue) ? parsedValue : null,
      recurring: recurring ?? false,
      sent_at: sent_at || null,
      valid_until: valid_until || null,
      contract_signed_at: contract_signed_at || null,
      contract_file_url: contract_file_url?.trim() || null,
      notes: notes?.trim() || null,
    })
    .select("*, client:clients(id, full_name, phone, email)")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ proposal: data }, { status: 201 });
}
