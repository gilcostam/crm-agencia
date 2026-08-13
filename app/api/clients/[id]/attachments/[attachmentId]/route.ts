import { NextRequest, NextResponse } from "next/server";
import { hasValidSession } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

const BUCKET = "client-attachments";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  if (!(await hasValidSession())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id, attachmentId } = await params;
  const supabase = createServiceClient();

  const { data: attachment, error: fetchError } = await supabase
    .from("client_attachments")
    .select("storage_path")
    .eq("id", attachmentId)
    .eq("client_id", id)
    .single();

  if (fetchError || !attachment) {
    return NextResponse.json({ error: "anexo não encontrado" }, { status: 404 });
  }

  const { error: storageError } = await supabase.storage
    .from(BUCKET)
    .remove([attachment.storage_path]);
  if (storageError) {
    console.error("Erro ao remover arquivo do storage:", storageError.message);
  }

  const { error } = await supabase.from("client_attachments").delete().eq("id", attachmentId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
