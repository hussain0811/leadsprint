import { z } from "zod";
import { handleInbound } from "@/lib/chat/pipeline";
import { crossSiteError, jsonError, parseBody } from "@/lib/http";
import { getOrg } from "@/lib/org";

// Generous on purpose: the guard answers long messages with a polite "keep it short".
const schema = z
  .object({
    text: z.string().max(20_000, "That message is too long to send.").optional(),
    replyId: z.string().trim().min(1).max(200).optional(),
  })
  .refine((b) => Boolean(b.text?.trim() || b.replyId), { message: "Type a message or tap an option." });

export async function POST(req: Request, ctx: RouteContext<"/api/chat/conversations/[id]/messages">) {
  const blocked = crossSiteError(req);
  if (blocked) return blocked;
  const { id } = await ctx.params;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;

  const org = await getOrg();
  try {
    const view = await handleInbound(org.id, id, body.data);
    return view ? Response.json(view) : jsonError("This conversation doesn't exist. It may have been deleted.", 404);
  } catch (err) {
    console.error("The bot's turn failed:", err);
    return jsonError("The message was saved, but the bot couldn't reply. Try again.", 500);
  }
}
