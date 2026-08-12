import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isValidSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { Client } from "@/lib/types";
import ClientesClient from "./clientes-client";

export default async function ClientesPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!isValidSessionToken(token)) {
    redirect("/login");
  }

  const supabase = createServiceClient();
  const [{ data: clients }, { data: proposals }] = await Promise.all([
    supabase.from("clients").select("*").order("full_name", { ascending: true }),
    supabase.from("proposals").select("client_id").not("client_id", "is", null),
  ]);

  // Contagem simples de propostas por cliente, calculada aqui pra não
  // precisar de outra viagem ao banco a partir do client component.
  const proposalCounts: Record<string, number> = {};
  for (const p of proposals ?? []) {
    if (!p.client_id) continue;
    proposalCounts[p.client_id] = (proposalCounts[p.client_id] ?? 0) + 1;
  }

  return (
    <ClientesClient
      initialClients={(clients as Client[]) ?? []}
      proposalCounts={proposalCounts}
    />
  );
}
