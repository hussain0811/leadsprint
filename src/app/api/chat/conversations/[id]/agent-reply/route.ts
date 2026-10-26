import { z } from "zod";
import { sendAgentReply } from "@/lib/chat/pipeline";
import { prisma } from "@/lib/db";
import { crossSiteError, jsonError, parseBody } from "@/lib/http";
import { getOrg } from "@/lib/org";

const NOT_FOUND = "This conversation doesn't exist. It may have been deleted.";
const NOT_TAKEN_OVER = "Take over the conversation before replying as a person.";

const schema = z.object({
  text: z.string().trim().min(1, "Type a reply.").max(4096, "Keep the reply under 4,096 characters."),
});

export async function POST(req: Request, ctx: RouteContext<"/api/chat/conversations/[id]/agent-reply">) {
  const blocked = crossSiteError(req);
  if (blocked) return blocked;
  const { id } = await ctx.params;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;

  const org = await getOrg();
  const conv = await prisma.conversation.findFirst({ where: { id, orgId: org.id }, select: { humanTakeover: true } });
  if (!conv) return jsonError(NOT_FOUND, 404);
  if (!conv.humanTakeover) return jsonError(NOT_TAKEN_OVER, 409);
  // Checked again inside the conversation's queue, in case the bot was handed back meanwhile.
  const result = await sendAgentReply(org.id, id, body.data.text);
  if (!result.ok) return result.reason === "not_found" ? jsonError(NOT_FOUND, 404) : jsonError(NOT_TAKEN_OVER, 409);
  return Response.json(result.view);
}
