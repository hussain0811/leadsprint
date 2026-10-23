import { prisma } from "@/lib/db";
import { crossSiteError, jsonError, parseBody } from "@/lib/http";
import { getOrg } from "@/lib/org";
import { missingMessage, planImport } from "@/lib/projects/import";
import { importApplySchema, PROJECT_NOT_FOUND } from "@/lib/projects/inputs";
import { findProject, getExistingUnits } from "@/lib/projects/queries";
import type { ImportResult } from "@/lib/projects/types";

// Applies a previewed import. The rows are checked and matched again against the units as they are
// now, so a unit added or changed since the preview is updated rather than duplicated.
export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/units/import">) {
  const blocked = crossSiteError(req);
  if (blocked) return blocked;
  const { id } = await ctx.params;
  const body = await parseBody(req, importApplySchema);
  if (!body.ok) return body.response;

  const org = await getOrg();
  if (!(await findProject(org.id, id))) return jsonError(PROJECT_NOT_FOUND, 404);

  const seen = new Set<string>();
  for (const row of body.data.rows) {
    const key = row.unitNo.toLowerCase();
    if (seen.has(key)) return jsonError(`Unit ${row.unitNo} appears more than once. Each unit can appear once.`);
    seen.add(key);
  }

  const plan = planImport(body.data.rows, await getExistingUnits(org.id, id));
  try {
    await prisma.$transaction([
      ...plan.add.map(({ row }) =>
        prisma.unit.create({
          data: {
            orgId: org.id,
            projectId: id,
            unitNo: row.unitNo,
            type: row.type!,
            bedrooms: row.bedrooms!,
            price: row.price!,
            sizeSqft: row.sizeSqft ?? null,
            status: row.status ?? "available",
            floor: row.floor ?? null,
            view: row.view ?? null,
          },
        }),
      ),
      ...plan.update.map(({ id: unitId, row, changes }) =>
        prisma.unit.update({
          where: { id: unitId },
          data: Object.fromEntries(changes.map((field) => [field, row[field]])),
        }),
      ),
    ]);
  } catch (err) {
    // Another import or edit added one of these units a moment ago.
    if ((err as { code?: string }).code === "P2002") {
      return jsonError("The units changed while importing. Nothing was imported; upload the file again.", 409);
    }
    throw err;
  }

  const result: ImportResult = {
    added: plan.add.length,
    updated: plan.update.length,
    unchanged: plan.unchanged,
    errors: plan.missing.map((m) => ({ unitNo: m.row.unitNo, message: missingMessage(m.row, m.fields) })),
  };
  return Response.json(result);
}
