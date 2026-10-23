import { connection } from "next/server";
import { prisma } from "@/lib/db";
import { crossSiteError, parseBody } from "@/lib/http";
import { getOrg } from "@/lib/org";
import { projectSchema } from "@/lib/projects/inputs";
import { getProjectDetail, getProjectList } from "@/lib/projects/queries";

export async function GET() {
  await connection();
  const org = await getOrg();
  return Response.json({ projects: await getProjectList(org.id) });
}

export async function POST(req: Request) {
  const blocked = crossSiteError(req);
  if (blocked) return blocked;
  const body = await parseBody(req, projectSchema);
  if (!body.ok) return body.response;

  const org = await getOrg();
  const project = await prisma.project.create({ data: { ...body.data, orgId: org.id } });
  return Response.json(await getProjectDetail(org.id, project.id), { status: 201 });
}
