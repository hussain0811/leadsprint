import { connection } from "next/server";
import { getDashboard } from "@/lib/dashboard/queries";
import { isPeriod } from "@/lib/dashboard/types";
import { jsonError } from "@/lib/http";
import { getOrg } from "@/lib/org";

// GET /api/dashboard?period=today|7d|30d -> DashboardData
export async function GET(req: Request) {
  await connection();
  const period = new URL(req.url).searchParams.get("period") ?? "7d";
  if (!isPeriod(period)) return jsonError("Choose a period: today, 7d or 30d.");
  const org = await getOrg();
  return Response.json(await getDashboard(org.id, period));
}
