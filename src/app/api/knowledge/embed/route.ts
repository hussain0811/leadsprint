import { describeAiError } from "@/lib/ai/client";
import { crossSiteError, jsonError } from "@/lib/http";
import { embedPendingChunks } from "@/lib/knowledge/ingest";
import { getOrg } from "@/lib/org";

// Catches up on embeddings: passages added while the AI server was down, or after the embedding model changed.
export async function POST(req: Request) {
  const blocked = crossSiteError(req);
  if (blocked) return blocked;
  const org = await getOrg();
  try {
    return Response.json(await embedPendingChunks(org.id));
  } catch (err) {
    return jsonError(describeAiError(err), 502);
  }
}
