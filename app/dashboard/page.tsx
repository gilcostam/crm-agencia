import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isValidSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { Lead } from "@/lib/types";
import DashboardClient from "./dashboard-client";

export default async function DashboardPage() {
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
    .order("created_at", { ascending: false });

  return <DashboardClient initialLeads={(data as Lead[]) ?? []} />;
}
