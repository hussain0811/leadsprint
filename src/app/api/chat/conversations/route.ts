import { connection } from "next/server";
import { z } from "zod";
import { startConversation } from "@/lib/chat/pipeline";
import { listConversations } from "@/lib/chat/views";
import { crossSiteError, jsonError, parseBody } from "@/lib/http";
import { findProject } from "@/lib/knowledge/queries";
import { getOrg } from "@/lib/org";

const schema = z.object({
  name: z.string().trim().max(100, "Keep the name under 100 characters.").default(""),
  phone: z
    .string()
    .trim()
    .max(30, "Keep the phone number under 30 characters.")
    .regex(/^[+\d\s()-]*$/, "Enter the phone number with digits only, like +971 50 123 4567.")
    .default(""),
  projectId: z.string().trim().min(1).nullable().default(null),
  language: z.enum(["en", "ar"], { error: "Choose English or Arabic." }).default("en"),
});

export async function GET() {
  await connection();
  const org = await getOrg();
  return Response.json({ conversations: await listConversations(org.id) });
}

export async function POST(req: Request) {
  const blocked = crossSiteError(req);
  if (blocked) return blocked;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const { name, phone, projectId, language } = body.data;

  const org = await getOrg();
  if (projectId && !(await findProject(org.id, projectId))) return jsonError("Choose a project from the list.");
  try {
    const view = await startConversation(org.id, { name, phone, projectId, language });
    return Response.json(view, { status: 201 });
  } catch (err) {
    console.error("Couldn't start the conversation:", err);
    return jsonError("Couldn't start the conversation. Check the flow on the Flows page and try again.", 500);
  }
}
