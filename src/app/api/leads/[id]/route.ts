import { connection } from "next/server";
import { crossSiteError, jsonError, parseBody } from "@/lib/http";
import { leadPatchSchema } from "@/lib/leads/inputs";
import { deleteLead, updateLead } from "@/lib/leads/mutations";
import { getLeadDetail } from "@/lib/leads/queries";
import { getOrg } from "@/lib/org";

const NOT_FOUND = "This lead doesn't exist. It may have been deleted.";

export async function GET(_req: Request, ctx: RouteContext<"/api/leads/[id]">) {
  await connection();
  const { id } = await ctx.params;
  const org = await getOrg();
  const lead = await getLeadDetail(org.id, id);
  if (!lead) return jsonError(NOT_FOUND, 404);
  return Response.json({ lead });
}

// Body: { name?, phone?, email?, status? }. Empty text clears a field.
export async function PATCH(req: Request, ctx: RouteContext<"/api/leads/[id]">) {
  const blocked = crossSiteError(req);
  if (blocked) return blocked;
  const { id } = await ctx.params;
  const body = await parseBody(req, leadPatchSchema);
  if (!body.ok) return body.response;
  const org = await getOrg();
  if (!(await updateLead(org.id, id, body.data))) return jsonError(NOT_FOUND, 404);
  return Response.json({ lead: await getLeadDetail(org.id, id) });
}

export async function DELETE(req: Request, ctx: RouteContext<"/api/leads/[id]">) {
  const blocked = crossSiteError(req);
  if (blocked) return blocked;
  const { id } = await ctx.params;
  const org = await getOrg();
  if (!(await deleteLead(org.id, id))) return jsonError(NOT_FOUND, 404);
  return Response.json({ ok: true });
}
