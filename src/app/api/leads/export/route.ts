import { connection, type NextRequest } from "next/server";
import { csvFileName, leadsCsv } from "@/lib/leads/csv";
import { parseLeadFilters } from "@/lib/leads/filters";
import { exportLeads } from "@/lib/leads/queries";
import { getOrg } from "@/lib/org";

// GET /api/leads/export?<same filters as the list> -> every matching lead as CSV (paging ignored).
export async function GET(req: NextRequest) {
  await connection();
  const org = await getOrg();
  const csv = leadsCsv(await exportLeads(org.id, parseLeadFilters(req.nextUrl.searchParams)));
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csvFileName()}"`,
      "Cache-Control": "no-store",
    },
  });
}
