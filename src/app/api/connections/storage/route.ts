import path from "node:path";
import { publicStorage, storageConfigSchema } from "@/lib/connections";
import { prisma } from "@/lib/db";
import { crossSiteError, jsonError, parseBody } from "@/lib/http";
import { getOrg } from "@/lib/org";
import { resolveFolder } from "@/lib/storage/local-folder";

export async function PUT(req: Request) {
  const blocked = crossSiteError(req);
  if (blocked) return blocked;
  const body = await parseBody(req, storageConfigSchema);
  if (!body.ok) return body.response;

  const folder = resolveFolder(body.data.path);
  if (path.parse(folder).root === folder) return jsonError("Choose a folder, not the whole drive.");

  const org = await getOrg();
  const data = {
    provider: "local_folder",
    name: "Folder on this computer",
    config: JSON.stringify(body.data),
    secret: null,
    status: "untested",
    lastCheck: "{}",
    lastCheckedAt: null,
  };
  const row = await prisma.connection.upsert({
    where: { orgId_type: { orgId: org.id, type: "storage" } },
    create: { orgId: org.id, type: "storage", ...data },
    update: data,
  });
  return Response.json({ storage: publicStorage(row) });
}

export async function DELETE(req: Request) {
  const blocked = crossSiteError(req);
  if (blocked) return blocked;
  const org = await getOrg();
  await prisma.connection.deleteMany({ where: { orgId: org.id, type: "storage" } });
  return Response.json({ storage: null });
}
