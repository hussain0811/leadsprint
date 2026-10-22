import { runAiChecks } from "@/lib/ai/checks";
import { createAiClient } from "@/lib/ai/client";
import { getAiConnection, publicAi } from "@/lib/connections";
import { prisma } from "@/lib/db";
import { crossSiteError, jsonError } from "@/lib/http";
import { checkEndpoint } from "@/lib/net";
import { getOrg } from "@/lib/org";

// Runs the connection checks against the saved AI connection and stores the result.
export async function POST(req: Request) {
  const blocked = crossSiteError(req);
  if (blocked) return blocked;
  const org = await getOrg();
  const saved = await getAiConnection(org.id);
  if (!saved) return jsonError("Save an AI connection first.", 404);

  const endpoint = await checkEndpoint(saved.config.baseUrl);
  if (!endpoint.ok) return jsonError(endpoint.reason);

  const client = createAiClient({ baseUrl: saved.config.baseUrl, apiKey: saved.apiKey, timeoutMs: 120_000 });
  const run = await runAiChecks(client, saved.config);

  const row = await prisma.connection.update({
    where: { id: saved.row.id },
    data: { status: run.status, lastCheck: JSON.stringify(run), lastCheckedAt: new Date(run.checkedAt) },
  });
  return Response.json({ ai: publicAi(row) });
}
