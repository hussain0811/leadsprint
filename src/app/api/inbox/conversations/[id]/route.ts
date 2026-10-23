import { z } from "zod";
import { getConversationView } from "@/lib/chat/views";
import { crossSiteError, jsonError, parseBody } from "@/lib/http";
import { setNeedsHuman } from "@/lib/inbox/queries";
import { getOrg } from "@/lib/org";

const schema = z.object({ needsHuman: z.boolean({ error: "Say whether the conversation still needs a person." }) });

// PATCH body { needsHuman } -> ConversationView. Marks "needs a person" as handled, or flags it again.
export async function PATCH(req: Request, ctx: RouteContext<"/api/inbox/conversations/[id]">) {
  const blocked = crossSiteError(req);
  if (blocked) return blocked;
  const { id } = await ctx.params;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;

  const org = await getOrg();
  if (!(await setNeedsHuman(org.id, id, body.data.needsHuman))) {
    return jsonError("This conversation doesn't exist. It may have been deleted.", 404);
  }
  return Response.json(await getConversationView(org.id, id));
}
