import { connection } from "next/server";
import { z } from "zod";
import { validateFlow } from "@/lib/chat/flow";
import { loadFlow } from "@/lib/chat/pipeline";
import { FLOW_NAME } from "@/lib/chat/turn";
import { prisma } from "@/lib/db";
import { crossSiteError, parseBody } from "@/lib/http";
import { getOrg } from "@/lib/org";

// Optional here so a missing definition gets the plain message below, not zod's.
const schema = z.object({ definition: z.unknown().optional() });

export async function GET() {
  await connection();
  const org = await getOrg();
  return Response.json({ definition: await loadFlow(org.id) });
}

// Saves the whole flow; refused with every problem listed when it isn't valid.
export async function PUT(req: Request) {
  const blocked = crossSiteError(req);
  if (blocked) return blocked;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const { definition } = body.data;
  if (definition === undefined || definition === null) return Response.json({ error: "Send the flow as { definition }." }, { status: 400 });

  const problems = validateFlow(definition);
  if (problems.length) return Response.json({ error: problems[0], problems }, { status: 400 });

  const org = await getOrg();
  const json = JSON.stringify(definition);
  await prisma.flow.upsert({
    where: { orgId_name: { orgId: org.id, name: FLOW_NAME } },
    create: { orgId: org.id, name: FLOW_NAME, definition: json, isDefault: true },
    update: { definition: json, isDefault: true },
  });
  return Response.json({ definition: await loadFlow(org.id) });
}
