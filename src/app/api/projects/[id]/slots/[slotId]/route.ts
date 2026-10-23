import { prisma } from "@/lib/db";
import { crossSiteError, jsonError } from "@/lib/http";
import { getOrg } from "@/lib/org";
import { SLOT_NOT_FOUND } from "@/lib/projects/inputs";

// Only free slots can be deleted, so a lead's booking never loses its time slot from here.
export async function DELETE(req: Request, ctx: RouteContext<"/api/projects/[id]/slots/[slotId]">) {
  const blocked = crossSiteError(req);
  if (blocked) return blocked;
  const { id, slotId } = await ctx.params;
  const org = await getOrg();
  const where = { id: slotId, projectId: id, orgId: org.id };
  const { count } = await prisma.availabilitySlot.deleteMany({ where: { ...where, booking: { is: null } } });
  if (count) return Response.json({ ok: true });
  const booked = await prisma.availabilitySlot.findFirst({ where, select: { id: true } });
  if (booked) return jsonError("This slot is booked, so it can't be deleted. Change the booking with the lead first.", 409);
  return jsonError(SLOT_NOT_FOUND, 404);
}
