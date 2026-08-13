import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isValidSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { ClientTask } from "@/lib/types";
import TarefasClient from "./tarefas-client";

export default async function TarefasPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!isValidSessionToken(token)) {
    redirect("/login");
  }

  const supabase = createServiceClient();
  const { data: tasks } = await supabase
    .from("client_tasks")
    .select("*, client:clients(id, full_name)")
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  return <TarefasClient initialTasks={(tasks as ClientTask[]) ?? []} />;
}
