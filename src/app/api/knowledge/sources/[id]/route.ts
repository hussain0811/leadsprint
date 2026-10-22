import { connection } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { crossSiteError, jsonError, parseBody } from "@/lib/http";
import { editSource } from "@/lib/knowledge/ingest";
import {
  prioritySchema,
  projectIdSchema,
  roleSchema,
  titleSchema,
  UNKNOWN_PROJECT,
  validUntilSchema,
} from "@/lib/knowledge/inputs";
import { findProject, getSourceDetail, getSourceView } from "@/lib/knowledge/queries";
import { getOrg } from "@/lib/org";
import { getStorage } from "@/lib/storage";

const NOT_FOUND = "This document doesn't exist. It may have been deleted.";

// Fields left out stay as they are.
const patchSchema = z.object({
  title: titleSchema.optional(),
  role: roleSchema.optional(),
  projectId: projectIdSchema.optional(),
  validUntil: validUntilSchema.optional(),
  priority: prioritySchema.optional(),
});

export async function GET(_req: Request, ctx: RouteContext<"/api/knowledge/sources/[id]">) {
  await connection();
  const { id } = await ctx.params;
  const org = await getOrg();
  const detail = await getSourceDetail(org.id, id);
  return detail ? Response.json(detail) : jsonError(NOT_FOUND, 404);
}

// Edits work from what is already stored; only Reprocess reads the original file or page again.
export async function PATCH(req: Request, ctx: RouteContext<"/api/knowledge/sources/[id]">) {
  const blocked = crossSiteError(req);
  if (blocked) return blocked;
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;
  const changes = body.data;

  const org = await getOrg();
  if (!(await prisma.knowledgeSource.count({ where: { id, orgId: org.id } }))) return jsonError(NOT_FOUND, 404);
  if (changes.projectId && !(await findProject(org.id, changes.projectId))) return jsonError(UNKNOWN_PROJECT);

  const refused = await editSource(org.id, id, changes);
  if (refused) return jsonError(refused.error);
  return Response.json({ source: await getSourceView(org.id, id) });
}

export async function DELETE(req: Request, ctx: RouteContext<"/api/knowledge/sources/[id]">) {
  const blocked = crossSiteError(req);
  if (blocked) return blocked;
  const { id } = await ctx.params;
  const org = await getOrg();
  const source = await prisma.knowledgeSource.findFirst({ where: { id, orgId: org.id }, select: { storageKey: true } });
  if (!source) return jsonError(NOT_FOUND, 404);

  // Passages go with the source (cascade).
  await prisma.knowledgeSource.deleteMany({ where: { id, orgId: org.id } });

  const key = source.storageKey;
  if (key) {
    // The source is already gone; a file left behind (storage disconnected, say) only takes up space.
    try {
      await (await getStorage(org.id)).remove(key);
    } catch (err) {
      console.warn(`Couldn't remove ${key} from storage:`, err instanceof Error ? err.message : err);
    }
  }
  return Response.json({ ok: true });
}
