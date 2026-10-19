import { z } from "zod";
import { createAiClient, describeAiError, listModels } from "@/lib/ai/client";
import { getAiConnection } from "@/lib/connections";
import { jsonError, parseBody } from "@/lib/http";
import { checkEndpoint } from "@/lib/net";
import { getOrg } from "@/lib/org";

const schema = z.object({
  baseUrl: z.string().trim().min(1, "Enter the server address.").max(500),
  apiKey: z.string().trim().max(1000).optional(),
});

// Lists the models a server offers, so the admin can pick instead of typing names.
export async function POST(req: Request) {
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const { baseUrl } = body.data;

  const endpoint = await checkEndpoint(baseUrl);
  if (!endpoint.ok) return jsonError(endpoint.reason);

  let apiKey = body.data.apiKey || null;
  if (!apiKey) {
    // Reuse the saved key only for the same server it was saved for.
    const saved = await getAiConnection((await getOrg()).id);
    if (saved?.config.baseUrl === baseUrl) apiKey = saved.apiKey;
  }

  try {
    const models = await listModels(createAiClient({ baseUrl, apiKey, timeoutMs: 15_000 }));
    return Response.json(models);
  } catch (err) {
    return jsonError(describeAiError(err), 502);
  }
}
