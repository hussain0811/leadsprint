import { connection } from "next/server";
import { getKnowledgeOverview } from "@/lib/knowledge/queries";
import { getOrg } from "@/lib/org";

export async function GET() {
  await connection();
  const org = await getOrg();
  return Response.json(await getKnowledgeOverview(org.id));
}
