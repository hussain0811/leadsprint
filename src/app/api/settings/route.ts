import { connection } from "next/server";
import { z } from "zod";
import { readSettings, SETTINGS_LIMITS } from "@/lib/chat/settings";
import { prisma } from "@/lib/db";
import { crossSiteError, parseBody } from "@/lib/http";
import { getOrg } from "@/lib/org";

// Values outside the allowed range are refused, not quietly changed.
const whole = (what: string, key: keyof typeof SETTINGS_LIMITS) => {
  const { min, max } = SETTINGS_LIMITS[key];
  const range = `${what} must be between ${min.toLocaleString("en")} and ${max.toLocaleString("en")}.`;
  return z.number({ error: `${what} must be a number.` }).int(`${what} must be a whole number.`).min(min, range).max(max, range);
};
const list = z.array(z.string().trim().max(200)).max(50, "Keep each list under 50 entries.");

// Fields left out stay as they are; readSettings fills gaps and cleans the lists.
const schema = z.object({
  settings: z.object({
    maxMessageChars: whole("The message length limit", "maxMessageChars").optional(),
    leadMessagesPerMinute: whole("Messages per minute", "leadMessagesPerMinute").optional(),
    strikeLimit: whole("The strike limit", "strikeLimit").optional(),
    offTopicStreakForStrike: whole("Off-topic messages per strike", "offTopicStreakForStrike").optional(),
    leadTokenBudget: whole("The lead token budget", "leadTokenBudget").optional(),
    monthlyTokenBudget: whole("The monthly token budget", "monthlyTokenBudget").optional(),
    scopeCheck: z.boolean().optional(),
    maxReplyChars: whole("The reply length limit", "maxReplyChars").optional(),
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
