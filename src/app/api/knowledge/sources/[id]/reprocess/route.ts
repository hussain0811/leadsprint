import { prisma } from "@/lib/db";
import { crossSiteError, jsonError } from "@/lib/http";
import { ingestSource } from "@/lib/knowledge/ingest";
import { getSourceView } from "@/lib/knowledge/queries";
import { getOrg } from "@/lib/org";

// Reads the source again: a changed web page, a fixed storage connection or a new embedding model.
export async function POST(req: Request, ctx: RouteContext<"/api/knowledge/sources/[id]/reprocess">) {
  const blocked = crossSiteError(req);
  if (blocked) return blocked;
  const { id } = await ctx.params;
  const org = await getOrg();
  if (!(await prisma.knowledgeSource.count({ where: { id, orgId: org.id } }))) {
    return jsonError("This document doesn't exist. It may have been deleted.", 404);
  }
  await ingestSource(id);
  return Response.json({ source: await getSourceView(org.id, id) });
}
