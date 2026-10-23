import { prisma } from "@/lib/db";
import { crossSiteError, jsonError, parseBody } from "@/lib/http";
import { getOrg } from "@/lib/org";
import { slotStarts } from "@/lib/projects/dubai-time";
import { MAX_SLOTS_PER_REQUEST, PROJECT_NOT_FOUND, slotsSchema } from "@/lib/projects/inputs";
import { findProject } from "@/lib/projects/queries";

// Adds viewing or call slots at the given Dubai times, on one day or the same times over several days.
// Times already passed, and times the project already has a slot at, are skipped and counted.
export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/slots">) {
  const blocked = crossSiteError(req);
  if (blocked) return blocked;
  const { id } = await ctx.params;
  const body = await parseBody(req, slotsSchema);
  if (!body.ok) return body.response;
  const { date, times, durationMin, kind, repeatDays } = body.data;

  const starts = slotStarts(date, times, repeatDays);
  if (starts.length > MAX_SLOTS_PER_REQUEST) {
    return jsonError(`That makes ${starts.length} slots. Add up to ${MAX_SLOTS_PER_REQUEST} at a time.`);
  }

  const org = await getOrg();
  if (!(await findProject(org.id, id))) return jsonError(PROJECT_NOT_FOUND, 404);

  const now = Date.now();
  const future = starts.filter((s) => s.getTime() > now);
  const existing = await prisma.availabilitySlot.findMany({
    where: { orgId: org.id, projectId: id, startsAt: { in: future } },
    select: { startsAt: true },
  });
  const taken = new Set(existing.map((s) => s.startsAt.getTime()));
  const fresh = future.filter((s) => !taken.has(s.getTime()));

  if (fresh.length) {
    await prisma.availabilitySlot.createMany({
      data: fresh.map((startsAt) => ({ orgId: org.id, projectId: id, startsAt, durationMin, kind })),
    });
  }
  return Response.json(
    { created: fresh.length, skippedPast: starts.length - future.length, skippedExisting: future.length - fresh.length },
    { status: fresh.length ? 201 : 200 },
  );
}
