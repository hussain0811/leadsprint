import { z } from "zod";
import { findPreset } from "@/lib/ai/presets";
import { aiConfigSchema, findConnection, publicAi, readAiConfig } from "@/lib/connections";
import { encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { jsonError, parseBody } from "@/lib/http";
import { checkEndpoint } from "@/lib/net";
import { getOrg } from "@/lib/org";

const saveSchema = aiConfigSchema.extend({
  // Omit to keep the saved key; send clearKey to remove it.
  apiKey: z.string().trim().max(1000).optional(),
  clearKey: z.boolean().optional(),
});

export async function PUT(req: Request) {
  const body = await parseBody(req, saveSchema);
  if (!body.ok) return body.response;
  const { apiKey, clearKey, ...config } = body.data;

  const endpoint = await checkEndpoint(config.baseUrl);
  if (!endpoint.ok) return jsonError(endpoint.reason);

  const org = await getOrg();
  const existing = await findConnection(org.id, "ai");

  let secret: string | null = null;
  let keyDropped = false;
  if (apiKey) {
    secret = encryptSecret(apiKey);
  } else if (!clearKey && existing?.secret) {
    // Never carry a saved key over to a different server address.
    if (readAiConfig(existing)?.baseUrl === config.baseUrl) secret = existing.secret;
    else keyDropped = true;
  }

  const data = {
    provider: "openai_compatible",
    name: findPreset(config.preset).label,
    config: JSON.stringify(config),
    secret,
    status: "untested",
    lastCheck: "{}",
    lastCheckedAt: null,
  };
  const row = await prisma.connection.upsert({
    where: { orgId_type: { orgId: org.id, type: "ai" } },
    create: { orgId: org.id, type: "ai", ...data },
    update: data,
  });
  return Response.json({ ai: publicAi(row), keyDropped });
}

export async function DELETE() {
  const org = await getOrg();
  await prisma.connection.deleteMany({ where: { orgId: org.id, type: "ai" } });
  return Response.json({ ai: null });
}
