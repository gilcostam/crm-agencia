import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { hasValidSession } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

const BUCKET = "lead-attachments";
const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1h

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
    .from("lead_attachments")
    .select("*")
    .eq("lead_id", id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const withUrls = await Promise.all(
    (data ?? []).map(async (att) => {
      const { data: signed } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(att.storage_path, SIGNED_URL_TTL_SECONDS);
      return { ...att, url: signed?.signedUrl ?? null };
    })
  );

  return NextResponse.json({ attachments: withUrls });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await hasValidSession())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "arquivo não enviado" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "arquivo maior que 10MB" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const ext = file.name.includes(".") ? file.name.split(".").pop() : "";
  const storagePath = `${id}/${randomUUID()}${ext ? "." + ext : ""}`;

  const arrayBuffer = await file.arrayBuffer();
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, Buffer.from(arrayBuffer), {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("lead_attachments")
    .insert({
      lead_id: id,
      file_name: file.name,
      storage_path: storagePath,
      content_type: file.type || null,
      size_bytes: file.size,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { error: eventError } = await supabase.from("lead_events").insert({
    lead_id: id,
    type: "attachment",
    message: `Arquivo "${file.name}" anexado`,
  });
  if (eventError) console.error("Erro ao registrar evento de anexo:", eventError.message);

  const { data: signed } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

  return NextResponse.json({ attachment: { ...data, url: signed?.signedUrl ?? null } });
}
