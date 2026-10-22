import { z } from "zod";
import { prisma } from "@/lib/db";
import { crossSiteError, jsonError, parseBody } from "@/lib/http";
import { embedQaPair } from "@/lib/knowledge/ingest";
import { answerSchema, projectIdSchema, questionSchema, UNKNOWN_PROJECT } from "@/lib/knowledge/inputs";
import { findProject, getQaView } from "@/lib/knowledge/queries";
import { getOrg } from "@/lib/org";

const schema = z.object({
  question: questionSchema,
  answer: answerSchema,
  projectId: projectIdSchema.default(null),
});

export async function POST(req: Request) {
  const blocked = crossSiteError(req);
  if (blocked) return blocked;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const { question, answer, projectId } = body.data;

  const org = await getOrg();
  if (projectId && !(await findProject(org.id, projectId))) return jsonError(UNKNOWN_PROJECT);

  const qa = await prisma.qaPair.create({ data: { orgId: org.id, projectId, question, answer } });
  await embedQaPair(org.id, qa.id);
  return Response.json({ qaPair: await getQaView(org.id, qa.id) }, { status: 201 });
}
