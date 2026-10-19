import { z } from "zod";
import type { Connection } from "@/generated/prisma/client";
import type { AiCheckRun } from "./ai/checks";
import { decryptSecret } from "./crypto";
import { prisma } from "./db";
import { resolveFolder, type StorageCheck } from "./storage/local-folder";

export const aiConfigSchema = z.object({
  preset: z.string().trim().max(40).default("custom"),
  baseUrl: z.string().trim().min(1, "Enter the server address.").max(500),
  chatModel: z.string().trim().min(1, "Choose a chat model.").max(200),
  embeddingModel: z.string().trim().max(200).default(""),
  // Small, fast model for the topic check on each message; empty means "use the chat model".
  scopeModel: z.string().trim().max(200).default(""),
});
export type AiConfig = z.infer<typeof aiConfigSchema>;

export const storageConfigSchema = z.object({
  path: z.string().trim().min(1, "Enter a folder path.").max(500),
});
export type StorageConfig = z.infer<typeof storageConfigSchema>;

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function findConnection(orgId: string, type: "ai" | "storage") {
  return prisma.connection.findUnique({ where: { orgId_type: { orgId, type } } });
}

export function readAiConfig(row: Connection): AiConfig | null {
  const parsed = aiConfigSchema.safeParse(parseJson(row.config, {}));
  return parsed.success ? parsed.data : null;
}

export function readStorageConfig(row: Connection): StorageConfig | null {
  const parsed = storageConfigSchema.safeParse(parseJson(row.config, {}));
  return parsed.success ? parsed.data : null;
}

// Server-side only: includes the decrypted key.
export async function getAiConnection(orgId: string) {
  const row = await findConnection(orgId, "ai");
  const config = row && readAiConfig(row);
  if (!row || !config) return null;
  return { row, config, apiKey: row.secret ? decryptSecret(row.secret) : null };
}

// What the browser may see: settings and check results, never the secret.
export function publicAi(row: Connection) {
  return {
    name: row.name,
    config: readAiConfig(row),
    hasKey: Boolean(row.secret),
    status: row.status,
    lastCheck: row.lastCheckedAt ? parseJson<AiCheckRun | null>(row.lastCheck, null) : null,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
  };
}

export function publicStorage(row: Connection) {
  const config = readStorageConfig(row);
  return {
    name: row.name,
    config: config && { ...config, resolvedPath: resolveFolder(config.path) },
    status: row.status,
    lastCheck: row.lastCheckedAt ? parseJson<StorageCheck | null>(row.lastCheck, null) : null,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
  };
}

export type PublicAiConnection = ReturnType<typeof publicAi>;
export type PublicStorageConnection = ReturnType<typeof publicStorage>;
export type ConnectionsResponse = {
  ai: PublicAiConnection | null;
  storage: PublicStorageConnection | null;
  allowPrivateEndpoints: boolean;
};
