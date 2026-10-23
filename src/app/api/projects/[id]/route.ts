import { connection } from "next/server";
import { prisma } from "@/lib/db";
import { crossSiteError, jsonError, parseBody } from "@/lib/http";
import { getOrg } from "@/lib/org";
import { PROJECT_NOT_FOUND, projectPatchSchema } from "@/lib/projects/inputs";
import { getProjectDetail } from "@/lib/projects/queries";
import { getStorage } from "@/lib/storage";

export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]">) {
  await connection();
  const { id } = await ctx.params;
  const org = await getOrg();
  const detail = await getProjectDetail(org.id, id);
  if (!detail) return jsonError(PROJECT_NOT_FOUND, 404);
  return Response.json(detail);
}

// Fields left out stay as they are.
export async function PATCH(req: Request, ctx: RouteContext<"/api/projects/[id]">) {
  const blocked = crossSiteError(req);
  if (blocked) return blocked;
  const { id } = await ctx.params;
  const body = await parseBody(req, projectPatchSchema);
  if (!body.ok) return body.response;

  const org = await getOrg();
  const { count } = await prisma.project.updateMany({ where: { id, orgId: org.id }, data: body.data });
  if (!count) return jsonError(PROJECT_NOT_FOUND, 404);
  return Response.json(await getProjectDetail(org.id, id));
}

// Units, viewing slots, documents and questions for the project go with it (cascade). Leads and
// bookings stay, without the project; a booking keeps its time when its slot goes.
export async function DELETE(req: Request, ctx: RouteContext<"/api/projects/[id]">) {
  const blocked = crossSiteError(req);
  if (blocked) return blocked;
  const { id } = await ctx.params;
  const org = await getOrg();
  const project = await prisma.project.findFirst({
    where: { id, orgId: org.id },
    select: { sources: { where: { storageKey: { not: null } }, select: { storageKey: true } } },
  });
  if (!project) return jsonError(PROJECT_NOT_FOUND, 404);

  await prisma.project.deleteMany({ where: { id, orgId: org.id } });

  // The documents are already gone; a file left behind (storage disconnected, say) only takes up space.
  const keys = project.sources.flatMap((s) => (s.storageKey ? [s.storageKey] : []));
  if (keys.length) {
    try {
      const storage = await getStorage(org.id);
      for (const key of keys) {
        await storage.remove(key).catch((err: unknown) => {
          console.warn(`Couldn't remove ${key} from storage:`, err instanceof Error ? err.message : err);
        });
      }
    } catch (err) {
      console.warn("Couldn't reach storage to remove the project's files:", err instanceof Error ? err.message : err);
    }
  }
  return Response.json({ ok: true });
}
