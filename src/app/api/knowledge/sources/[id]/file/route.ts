import { connection } from "next/server";
import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/http";
import { MISSING_FILE } from "@/lib/knowledge/ingest";
import { getOrg } from "@/lib/org";
import { getStorage, type StorageAdapter } from "@/lib/storage";

// Plain-ASCII fallback plus the exact UTF-8 name (RFC 6266), so Arabic file names survive the download.
function attachment(fileName: string) {
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export async function GET(_req: Request, ctx: RouteContext<"/api/knowledge/sources/[id]/file">) {
  await connection();
  const { id } = await ctx.params;
  const org = await getOrg();
  const source = await prisma.knowledgeSource.findFirst({
    where: { id, orgId: org.id },
    select: { storageKey: true, fileName: true, mimeType: true },
  });
  if (!source) return jsonError("This document doesn't exist. It may have been deleted.", 404);
  if (!source.storageKey) return jsonError("This source has no original file.", 404);

  let storage: StorageAdapter;
  try {
    storage = await getStorage(org.id);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "File storage isn't available.");
  }

  let data: Buffer;
  try {
    data = await storage.get(source.storageKey);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return jsonError(MISSING_FILE, 404);
    }
    return jsonError(err instanceof Error ? err.message : "Couldn't read the file from storage.", 500);
  }

  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": source.mimeType ?? "application/octet-stream",
      "Content-Disposition": attachment(source.fileName ?? "document"),
      "Content-Length": String(data.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
