import { prisma } from "@/lib/db";
import { crossSiteError, jsonError, parseBody } from "@/lib/http";
import { getOrg } from "@/lib/org";
import { UNIT_NOT_FOUND, unitPatchSchema } from "@/lib/projects/inputs";
import { findUnitNoClash, getUnitView } from "@/lib/projects/queries";

// Fields left out stay as they are.
export async function PATCH(req: Request, ctx: RouteContext<"/api/projects/[id]/units/[unitId]">) {
  const blocked = crossSiteError(req);
  if (blocked) return blocked;
  const { id, unitId } = await ctx.params;
  const body = await parseBody(req, unitPatchSchema);
  if (!body.ok) return body.response;

  const org = await getOrg();
  if (body.data.unitNo !== undefined) {
    const clash = await findUnitNoClash(org.id, id, body.data.unitNo, unitId);
    if (clash) return jsonError(`Unit ${clash.unitNo} is already in this project. Use another unit number.`, 409);
  }
  try {
    const { count } = await prisma.unit.updateMany({ where: { id: unitId, projectId: id, orgId: org.id }, data: body.data });
    if (!count) return jsonError(UNIT_NOT_FOUND, 404);
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      return jsonError(`Unit ${body.data.unitNo} is already in this project. Use another unit number.`, 409);
    }
    throw err;
  }
  return Response.json({ unit: await getUnitView(org.id, unitId) });
}

export async function DELETE(req: Request, ctx: RouteContext<"/api/projects/[id]/units/[unitId]">) {
  const blocked = crossSiteError(req);
  if (blocked) return blocked;
  const { id, unitId } = await ctx.params;
  const org = await getOrg();
  const { count } = await prisma.unit.deleteMany({ where: { id: unitId, projectId: id, orgId: org.id } });
  if (!count) return jsonError(UNIT_NOT_FOUND, 404);
  return Response.json({ ok: true });
}
