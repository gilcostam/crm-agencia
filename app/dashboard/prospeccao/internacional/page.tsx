import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isValidSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { Lead } from "@/lib/types";
import DashboardClient from "../../dashboard-client";

/** Janela separada pra leads dos EUA/Canadá (source = "internacional"), no
 * mesmo espírito de app/dashboard/prospeccao/instagram/page.tsx: esses leads
 * têm abordagem própria, em inglês e bem mais curta/direta (cultura "time is
 * money", ver canal "internacional" em lib/whatsapp-templates.ts), então não
 * faz sentido misturar visualmente com o Kanban de Prospecção Ativa (TNG) nem
 * com o de Instagram (ambos em português). Reaproveita o mesmo
 * Kanban/board (DashboardClient), só que restrito a `source = "internacional"`
 * tanto na carga inicial quanto no polling (via `pollQuery`), com
 * `defaultLeadSource="internacional"` pra que um cadastro manual feito aqui
 * (botão "+ Novo lead") já nasça marcado com o `source` certo (ver
 * app/api/leads/route.ts). */
export default async function ProspeccaoInternacionalPage() {
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
    .eq("source", "internacional")
    .order("created_at", { ascending: false });

  return (
    <DashboardClient
      initialLeads={(data as Lead[]) ?? []}
      title="Prospecção EUA/Canadá"
      pollQuery="source=internacional"
      enableInternationalSheetImport
      defaultLeadSource="internacional"
    />
  );
}
