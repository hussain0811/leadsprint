import { z } from "zod";
import { prisma } from "@/lib/db";
import { crossSiteError, jsonError, parseBody } from "@/lib/http";
import { embedQaPair } from "@/lib/knowledge/ingest";
import { answerSchema, projectIdSchema, questionSchema, UNKNOWN_PROJECT } from "@/lib/knowledge/inputs";
import { findProject, getQaView } from "@/lib/knowledge/queries";
import { getOrg } from "@/lib/org";

const NOT_FOUND = "This question doesn't exist. It may have been deleted.";

// Fields left out stay as they are.
const patchSchema = z.object({
  question: questionSchema.optional(),
  answer: answerSchema.optional(),
  projectId: projectIdSchema.optional(),
});

export async function PATCH(req: Request, ctx: RouteContext<"/api/knowledge/qa/[id]">) {
  const blocked = crossSiteError(req);
  if (blocked) return blocked;
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;
  const changes = body.data;

  const org = await getOrg();
  const qa = await prisma.qaPair.findFirst({ where: { id, orgId: org.id }, select: { question: true, answer: true } });
  if (!qa) return jsonError(NOT_FOUND, 404);
  if (changes.projectId && !(await findProject(org.id, changes.projectId))) return jsonError(UNKNOWN_PROJECT);

  // The embedding is made from the question and answer, so new wording needs a new one.
  const reworded =
    (changes.question !== undefined && changes.question !== qa.question) ||
    (changes.answer !== undefined && changes.answer !== qa.answer);
  await prisma.qaPair.update({
    where: { id },
    data: { ...changes, ...(reworded ? { embedding: null, embeddingModel: null } : {}) },
  });
  if (reworded) await embedQaPair(org.id, id);

  return Response.json({ qaPair: await getQaView(org.id, id) });
}

export async function DELETE(req: Request, ctx: RouteContext<"/api/knowledge/qa/[id]">) {
  const blocked = crossSiteError(req);
  if (blocked) return blocked;
  const { id } = await ctx.params;
  const org = await getOrg();
  const { count } = await prisma.qaPair.deleteMany({ where: { id, orgId: org.id } });
  if (!count) return jsonError(NOT_FOUND, 404);
  return Response.json({ ok: true });
}
