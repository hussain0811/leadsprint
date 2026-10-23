import { crossSiteError, jsonError, parseBody } from "@/lib/http";
import { bookingPatchSchema } from "@/lib/leads/inputs";
import { setBookingStatus } from "@/lib/leads/mutations";
import { getLeadDetail } from "@/lib/leads/queries";
import { getOrg } from "@/lib/org";

// Body: { status: "cancelled" | "done" } -> { lead: LeadDetail }. Cancelling frees the slot for other leads.
export async function PATCH(req: Request, ctx: RouteContext<"/api/leads/[id]/bookings/[bookingId]">) {
  const blocked = crossSiteError(req);
  if (blocked) return blocked;
  const { id, bookingId } = await ctx.params;
  const body = await parseBody(req, bookingPatchSchema);
  if (!body.ok) return body.response;
  const org = await getOrg();
  const result = await setBookingStatus(org.id, id, bookingId, body.data.status);
  if (result === "not_found") return jsonError("This booking doesn't exist. It may have been deleted.", 404);
  if (result === "already_cancelled") return jsonError("This booking was already cancelled.", 409);
  return Response.json({ lead: await getLeadDetail(org.id, id) });
}
