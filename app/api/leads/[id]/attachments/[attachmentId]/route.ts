import { NextRequest, NextResponse } from "next/server";
import { hasValidSession } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

const BUCKET = "lead-attachments";

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
    .from("lead_attachments")
    .select("storage_path, file_name")
    .eq("id", attachmentId)
    .eq("lead_id", id)
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

  const { error } = await supabase.from("lead_attachments").delete().eq("id", attachmentId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { error: eventError } = await supabase.from("lead_events").insert({
    lead_id: id,
    type: "attachment",
    message: `Arquivo "${attachment.file_name}" removido`,
  });
  if (eventError) console.error("Erro ao registrar evento de anexo:", eventError.message);

  return NextResponse.json({ ok: true });
}
