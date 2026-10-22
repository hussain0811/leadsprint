import { z } from "zod";
import { prisma } from "@/lib/db";
import { crossSiteError, jsonError, parseBody } from "@/lib/http";
import { checkPageUrl } from "@/lib/knowledge/fetch-page";
import { ingestSource } from "@/lib/knowledge/ingest";
import { normalizePageAddress, projectIdSchema, roleSchema, UNKNOWN_PROJECT } from "@/lib/knowledge/inputs";
import { findProject, getSourceView } from "@/lib/knowledge/queries";
import { getOrg } from "@/lib/org";

const schema = z.object({
  url: z.string().trim().min(1, "Enter the page address.").max(2000, "That address is too long."),
  role: roleSchema,
  projectId: projectIdSchema.default(null),
  title: z.string().trim().max(200, "Keep the title under 200 characters.").optional(),
});

export async function POST(req: Request) {
  const blocked = crossSiteError(req);
  if (blocked) return blocked;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const { role, projectId, title } = body.data;

  // Catch typos and blocked addresses here; the page itself is read during processing.
  const check = await checkPageUrl(normalizePageAddress(body.data.url));
  if (!check.ok) return jsonError(check.reason);
  const url = check.url.href;

  const org = await getOrg();
  if (projectId && !(await findProject(org.id, projectId))) return jsonError(UNKNOWN_PROJECT);

  // Without a title the source shows its address until processing finds the page's own title.
  const source = await prisma.knowledgeSource.create({
    data: { orgId: org.id, projectId, kind: "url", role, title: title || url, url },
  });
  await ingestSource(source.id);
  return Response.json({ source: await getSourceView(org.id, source.id) }, { status: 201 });
}
