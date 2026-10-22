import { connection } from "next/server";
import { z } from "zod";
import { readSettings } from "@/lib/chat/settings";
import { prisma } from "@/lib/db";
import { crossSiteError, parseBody } from "@/lib/http";
import { getOrg } from "@/lib/org";

const whole = (what: string) => z.number({ error: `${what} must be a number.` }).int(`${what} must be a whole number.`).min(0, `${what} can't be negative.`);
const list = z.array(z.string().trim().max(200)).max(50, "Keep each list under 50 entries.");

// Fields left out stay as they are; readSettings fills gaps and clamps values out of range.
const schema = z.object({
  settings: z.object({
    maxMessageChars: whole("The message length limit").optional(),
    leadMessagesPerMinute: whole("Messages per minute").optional(),
    strikeLimit: whole("The strike limit").optional(),
    offTopicStreakForStrike: whole("Off-topic messages per strike").optional(),
    leadTokenBudget: whole("The lead token budget").optional(),
    monthlyTokenBudget: whole("The monthly token budget").optional(),
    scopeCheck: z.boolean().optional(),
    maxReplyChars: whole("The reply length limit").optional(),
    allowedLinkDomains: list.optional(),
    allowedPhones: list.optional(),
  }),
});

export async function GET() {
  await connection();
  const org = await getOrg();
  return Response.json({ settings: readSettings(org.settings) });
}

export async function PUT(req: Request) {
  const blocked = crossSiteError(req);
  if (blocked) return blocked;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;

  const org = await getOrg();
  const changes = Object.fromEntries(Object.entries(body.data.settings).filter(([, v]) => v !== undefined));
  const settings = readSettings(JSON.stringify({ ...readSettings(org.settings), ...changes }));
  await prisma.org.update({ where: { id: org.id }, data: { settings: JSON.stringify(settings) } });
  return Response.json({ settings });
}
