import type { Prisma } from "@/generated/prisma/client";
import { aiUnavailable } from "@/lib/chat/pipeline";
import type { Score } from "@/lib/chat/types";
import { findConnection } from "@/lib/connections";
import { prisma } from "@/lib/db";
import { answeringMode, previewText, sortByActivity } from "./filters";
import type { InboxFilters, InboxItem, InboxResponse } from "./types";

const LIMIT = 200;
const SCORES: Score[] = ["hot", "warm", "cold", "unknown"];

export function inboxWhere(orgId: string, f: InboxFilters): Prisma.ConversationWhereInput {
  const where: Prisma.ConversationWhereInput = { orgId };
  if (f.needsHuman) where.needsHuman = true;
  if (f.takeover) where.humanTakeover = true;
  if (f.projectId) where.lead = { projectId: f.projectId === "none" ? null : f.projectId };
  if (f.q) {
    where.OR = [
      { lead: { name: { contains: f.q } } },
      { lead: { phone: { contains: f.q } } },
      { messages: { some: { body: { contains: f.q } } } },
    ];
  }
  return where;
}

export async function listInbox(orgId: string, filters: InboxFilters): Promise<InboxResponse> {
  const [rows, projects, needsHuman, takeover, aiRow] = await Promise.all([
    prisma.conversation.findMany({
      where: inboxWhere(orgId, filters),
      orderBy: { updatedAt: "desc" },
      take: LIMIT,
      include: {
        lead: { select: { id: true, name: true, phone: true, projectId: true, score: true, aiStopped: true, project: { select: { name: true } } } },
        messages: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { body: true, author: true, createdAt: true } },
      },
    }),
    prisma.project.findMany({ where: { orgId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.conversation.count({ where: { orgId, needsHuman: true } }),
    prisma.conversation.count({ where: { orgId, humanTakeover: true } }),
    findConnection(orgId, "ai"),
  ]);
  const aiReady = aiUnavailable(aiRow) === null;

  const items: InboxItem[] = rows.map((c) => {
    const last = c.messages[0];
    return {
      id: c.id,
      leadId: c.lead.id,
      leadName: c.lead.name,
      leadPhone: c.lead.phone,
      projectId: c.lead.projectId,
      projectName: c.lead.project?.name ?? null,
      score: SCORES.includes(c.lead.score as Score) ? (c.lead.score as Score) : "unknown",
      needsHuman: c.needsHuman,
      humanTakeover: c.humanTakeover,
      answering: answeringMode({ humanTakeover: c.humanTakeover, forceScripted: c.forceScripted, aiStopped: c.lead.aiStopped, aiReady }),
      lastMessage: last ? previewText(last.body) : "",
      lastAuthor: last?.author ?? null,
      lastActivityAt: (last?.createdAt ?? c.createdAt).toISOString(),
    };
  });
  return { items: sortByActivity(items), projects, counts: { needsHuman, takeover } };
}

/** Marks "needs a person" as handled (or flags it again). False when the conversation isn't found. */
export async function setNeedsHuman(orgId: string, id: string, needsHuman: boolean): Promise<boolean> {
  const { count } = await prisma.conversation.updateMany({ where: { id, orgId }, data: { needsHuman } });
  return count > 0;
}
