import { z } from "zod";
import { sendAgentReply } from "@/lib/chat/pipeline";
import { prisma } from "@/lib/db";
import { crossSiteError, jsonError, parseBody } from "@/lib/http";
import { getOrg } from "@/lib/org";

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
  if (!conv) return jsonError("This conversation doesn't exist. It may have been deleted.", 404);
  if (!conv.humanTakeover) return jsonError("Take over the conversation before replying as a person.", 409);
  return Response.json(await sendAgentReply(org.id, id, body.data.text));
}
