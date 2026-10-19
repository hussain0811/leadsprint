import { findConnection, publicStorage, readStorageConfig } from "@/lib/connections";
import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/http";
import { getOrg } from "@/lib/org";
import { localFolderStorage, testStorage } from "@/lib/storage/local-folder";

export async function POST() {
  const org = await getOrg();
  const row = await findConnection(org.id, "storage");
  if (!row) return jsonError("Save a storage folder first.", 404);
  const config = readStorageConfig(row);
  if (!config) return jsonError("The saved storage settings aren't valid. Save them again.");

  const check = await testStorage(localFolderStorage(config.path));
  const updated = await prisma.connection.update({
    where: { id: row.id },
    data: { status: check.status, lastCheck: JSON.stringify(check), lastCheckedAt: new Date(check.checkedAt) },
  });
  return Response.json({ storage: publicStorage(updated) });
}
