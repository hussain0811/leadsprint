import { z } from "zod";
import { prisma } from "@/lib/db";
import { crossSiteError, jsonError, parseBody } from "@/lib/http";
import { ingestSource } from "@/lib/knowledge/ingest";
import { MAX_TEXT_CHARS, projectIdSchema, roleSchema, titleSchema, UNKNOWN_PROJECT } from "@/lib/knowledge/inputs";
import { findProject, getSourceView } from "@/lib/knowledge/queries";
import { getOrg } from "@/lib/org";

const schema = z.object({
  title: titleSchema,
  text: z
    .string()
    .trim()
    .min(1, "Enter the text.")
    .max(MAX_TEXT_CHARS, `Keep the text under ${MAX_TEXT_CHARS.toLocaleString("en-US")} characters, or upload it as a file.`),
  role: roleSchema,
  projectId: projectIdSchema.default(null),
});

export async function POST(req: Request) {
  const blocked = crossSiteError(req);
  if (blocked) return blocked;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const { title, text, role, projectId } = body.data;

  const org = await getOrg();
  if (projectId && !(await findProject(org.id, projectId))) return jsonError(UNKNOWN_PROJECT);

  const source = await prisma.knowledgeSource.create({
    data: { orgId: org.id, projectId, kind: "text", role, title, text },
  });
  await ingestSource(source.id);
  return Response.json({ source: await getSourceView(org.id, source.id) }, { status: 201 });
}
