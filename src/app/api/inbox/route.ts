import { connection } from "next/server";
import { parseFilters } from "@/lib/inbox/filters";
import { listInbox } from "@/lib/inbox/queries";
import { getOrg } from "@/lib/org";

// GET /api/inbox?needs=1&takeover=1&project=<id|none>&q=<text> -> InboxResponse
export async function GET(req: Request) {
  await connection();
  const org = await getOrg();
  const filters = parseFilters(new URL(req.url).searchParams);
  return Response.json(await listInbox(org.id, filters));
}
