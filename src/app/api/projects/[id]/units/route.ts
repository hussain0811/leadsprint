import { prisma } from "@/lib/db";
import { crossSiteError, jsonError, parseBody } from "@/lib/http";
import { getOrg } from "@/lib/org";
import { PROJECT_NOT_FOUND, unitSchema } from "@/lib/projects/inputs";
import { findProject, unitView } from "@/lib/projects/queries";

export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/units">) {
  const blocked = crossSiteError(req);
  if (blocked) return blocked;
  const { id } = await ctx.params;
  const body = await parseBody(req, unitSchema);
  if (!body.ok) return body.response;

  const org = await getOrg();
  if (!(await findProject(org.id, id))) return jsonError(PROJECT_NOT_FOUND, 404);
  try {
    const unit = await prisma.unit.create({ data: { ...body.data, orgId: org.id, projectId: id } });
    return Response.json({ unit: unitView(unit) }, { status: 201 });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      return jsonError(`Unit ${body.data.unitNo} is already in this project. Edit it in the list instead.`, 409);
    }
    throw err;
  }
}
