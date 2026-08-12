import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isValidSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { Client, Lead, Proposal } from "@/lib/types";
import PropostasClient from "./propostas-client";

export default async function PropostasPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!isValidSessionToken(token)) {
    redirect("/login");
  }

  const supabase = createServiceClient();
  const [{ data: proposals }, { data: clients }, { data: leads }] = await Promise.all([
    supabase
      .from("proposals")
      .select("*, client:clients(id, full_name, phone, email)")
      .order("created_at", { ascending: false }),
    supabase.from("clients").select("*").order("full_name", { ascending: true }),
    supabase
      .from("leads")
      .select("*")
      .is("merged_into_lead_id", null)
      .order("created_at", { ascending: false }),
  ]);

  return (
    <PropostasClient
      initialProposals={(proposals as Proposal[]) ?? []}
      initialClients={(clients as Client[]) ?? []}
      initialLeads={(leads as Lead[]) ?? []}
    />
  );
}
