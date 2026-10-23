import { connection, type NextRequest } from "next/server";
import { parseLeadFilters } from "@/lib/leads/filters";
import { listLeads } from "@/lib/leads/queries";
import { getOrg } from "@/lib/org";

// GET /api/leads?score&status&project&needsPerson&q&sort&page -> LeadListResponse
export async function GET(req: NextRequest) {
  await connection();
  const org = await getOrg();
  return Response.json(await listLeads(org.id, parseLeadFilters(req.nextUrl.searchParams)));
}
