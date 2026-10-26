import { connection } from "next/server";
import { z } from "zod";
import { readFlowState } from "@/lib/chat/pipeline";
import { getConversationView } from "@/lib/chat/views";
import { prisma } from "@/lib/db";
import { crossSiteError, jsonError, parseBody } from "@/lib/http";
import { getOrg } from "@/lib/org";

const NOT_FOUND = "This conversation doesn't exist. It may have been deleted.";

const patchSchema = z.object({
  forceScripted: z.boolean().optional(),
  humanTakeover: z.boolean().optional(),
});

export async function GET(_req: Request, ctx: RouteContext<"/api/chat/conversations/[id]">) {
  await connection();
  const { id } = await ctx.params;
  const org = await getOrg();
  const view = await getConversationView(org.id, id);
  return view ? Response.json(view) : jsonError(NOT_FOUND, 404);
}

export async function PATCH(req: Request, ctx: RouteContext<"/api/chat/conversations/[id]">) {
  const blocked = crossSiteError(req);
  if (blocked) return blocked;
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  const org = await getOrg();
  const conv = await prisma.conversation.findFirst({ where: { id, orgId: org.id }, select: { humanTakeover: true, flowState: true } });
  if (!conv) return jsonError(NOT_FOUND, 404);

  // Handing back to the bot: the flow picks up at the next unanswered question, not where it left off.
  const handBack = body.data.humanTakeover === false && conv.humanTakeover;
  const state = handBack ? readFlowState(conv.flowState) : null;
  await prisma.conversation.updateMany({
    where: { id, orgId: org.id },
    data: { ...body.data, ...(handBack ? { flowState: JSON.stringify({ stepId: null, lang: state?.lang ?? "en", retries: 0 }) } : {}) },
  });
  return Response.json(await getConversationView(org.id, id));
}

// Deletes the conversation, and the lead with it when it's a simulator test lead.
export async function DELETE(req: Request, ctx: RouteContext<"/api/chat/conversations/[id]">) {
  const blocked = crossSiteError(req);
  if (blocked) return blocked;
  const { id } = await ctx.params;
  const org = await getOrg();
  const conv = await prisma.conversation.findFirst({ where: { id, orgId: org.id }, select: { lead: { select: { id: true, source: true } } } });
  if (!conv) return jsonError(NOT_FOUND, 404);

  if (conv.lead.source === "simulator") {
    await prisma.lead.deleteMany({ where: { id: conv.lead.id, orgId: org.id } }); // the conversation goes with it
  } else {
    await prisma.conversation.deleteMany({ where: { id, orgId: org.id } });
  }
  return Response.json({ ok: true });
}
