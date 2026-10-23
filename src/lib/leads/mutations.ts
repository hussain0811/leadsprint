import { prisma } from "@/lib/db";
import type { LeadPatch } from "./inputs";

// Writes for the lead routes. Server only. Each returns false when the lead or booking isn't this org's.

/**
 * Saves edits. Handing a lead to a person or closing it means someone has dealt with the request
 * for a person, so the "needs a person" flag on its conversations is cleared.
 */
export async function updateLead(orgId: string, id: string, patch: LeadPatch): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.lead.updateMany({ where: { id, orgId }, data: patch });
    if (!count) return false;
    if (patch.status === "handed_off" || patch.status === "closed") {
      await tx.conversation.updateMany({ where: { leadId: id, orgId, needsHuman: true }, data: { needsHuman: false } });
    }
    return true;
  });
}

/** Cancelling unlinks the slot (slotId is unique on Booking), so another lead can book that time. */
export async function setBookingStatus(
  orgId: string,
  leadId: string,
  bookingId: string,
  status: "cancelled" | "done",
): Promise<"ok" | "not_found" | "already_cancelled"> {
  const booking = await prisma.booking.findFirst({ where: { id: bookingId, leadId, orgId }, select: { status: true } });
  if (!booking) return "not_found";
  if (booking.status === "cancelled") return "already_cancelled";
  await prisma.booking.update({
    where: { id: bookingId },
    data: status === "cancelled" ? { status, slotId: null } : { status },
  });
  return "ok";
}

/** Conversations, messages and bookings go with the lead; booked slots become free again. */
export async function deleteLead(orgId: string, id: string): Promise<boolean> {
  const { count } = await prisma.lead.deleteMany({ where: { id, orgId } });
  return count > 0;
}
