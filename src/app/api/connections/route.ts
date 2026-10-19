import { connection } from "next/server";
import { findConnection, publicAi, publicStorage, type ConnectionsResponse } from "@/lib/connections";
import { privateEndpointsAllowed } from "@/lib/net";
import { getOrg } from "@/lib/org";

export async function GET() {
  await connection();
  const org = await getOrg();
  const [ai, storage] = await Promise.all([findConnection(org.id, "ai"), findConnection(org.id, "storage")]);
  const body: ConnectionsResponse = {
    ai: ai ? publicAi(ai) : null,
    storage: storage ? publicStorage(storage) : null,
    allowPrivateEndpoints: privateEndpointsAllowed(),
  };
  return Response.json(body);
}
