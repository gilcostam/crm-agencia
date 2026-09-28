import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isValidSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { Lead } from "@/lib/types";
import DashboardClient from "../../dashboard-client";

/** Janela separada só pra leads de Instagram (source = "instagram"), fora do
 * Kanban de "Prospecção Ativa" (esse hoje é só TNG/Maps, ver
 * app/dashboard/prospeccao/page.tsx). Leads de Instagram têm abordagem
 * própria, mais curta e adaptada ao Direct (ver canal "instagram" em
 * lib/whatsapp-templates.ts e app/dashboard/_components/InstagramComposerModal.tsx),
 * então faz sentido não misturar visualmente com os leads de TNG nem com os
 * modelos de mensagem deles. Reaproveita o mesmo Kanban/board (DashboardClient),
 * só que restrito a `source = "instagram"` tanto na carga inicial quanto no
 * polling (via `pollQuery`). */
export default async function ProspeccaoInstagramPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!isValidSessionToken(token)) {
    redirect("/login");
  }

  const supabase = createServiceClient();
  const { data } = await supabase
    .from("leads")
    .select("*")
    .is("merged_into_lead_id", null)
    .eq("source", "instagram")
    .order("created_at", { ascending: false });

  return (
    <DashboardClient
      initialLeads={(data as Lead[]) ?? []}
      title="Prospecção Instagram"
      pollQuery="source=instagram"
      enableInstagramImport
      enableInstagramSheetImport
    />
  );
}
