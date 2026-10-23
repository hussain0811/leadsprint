import { readSettings } from "@/lib/chat/settings";
import { aiUnavailable, monthTokensUsed } from "@/lib/chat/pipeline";
import { findConnection, parseJson, readAiConfig } from "@/lib/connections";
import { prisma } from "@/lib/db";
import { bucketCounts, firstReplyMs, isQualified, parseStringArray, periodRange, summarizeReplies, tallyRuns } from "./metrics";
import type { DashboardData, Period, SetupItem } from "./types";

const LIST_SIZE = 5;

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

async function setupChecklist(orgId: string, now: Date): Promise<SetupItem[]> {
  const [aiRow, storageRow, readyDocs, failedDocs, projects, projectsWithUnits, freeSlots, savedFlows] = await Promise.all([
    findConnection(orgId, "ai"),
    findConnection(orgId, "storage"),
    prisma.knowledgeSource.count({ where: { orgId, status: "ready" } }),
    prisma.knowledgeSource.count({ where: { orgId, status: "failed" } }),
    prisma.project.count({ where: { orgId } }),
    prisma.project.count({ where: { orgId, units: { some: {} } } }),
    prisma.availabilitySlot.count({ where: { orgId, startsAt: { gt: now }, booking: null } }),
    prisma.flow.count({ where: { orgId } }),
  ]);

  const aiProblem = aiUnavailable(aiRow);
  const aiModel = aiRow ? readAiConfig(aiRow)?.chatModel : null;
  const ai: SetupItem = {
    key: "ai",
    label: "AI connection",
    href: "/connections",
    done: aiProblem === null,
    tone: aiProblem === null ? "ok" : aiRow?.status === "error" ? "bad" : aiRow ? "warn" : "muted",
    detail: aiProblem === null ? `Ready${aiModel ? `, using ${aiModel}` : ""}` : `${aiProblem}. The scripted flow answers until it's fixed.`,
  };

  const storageStatus = storageRow?.status;
  const storage: SetupItem = {
    key: "storage",
    label: "File storage",
    href: "/connections",
    done: storageStatus === "ok",
    tone: !storageRow ? "muted" : storageStatus === "ok" ? "ok" : storageStatus === "error" ? "bad" : "warn",
    detail: !storageRow
      ? "Not connected. Needed to keep uploaded brochures and price lists."
      : storageStatus === "ok"
        ? "Ready"
        : storageStatus === "error"
          ? "Failed its last check"
          : "Saved, not tested yet",
  };

  const knowledge: SetupItem = {
    key: "knowledge",
    label: "Knowledge documents",
    href: "/knowledge",
    done: readyDocs > 0,
    tone: failedDocs > 0 ? "warn" : readyDocs > 0 ? "ok" : "muted",
    detail:
      readyDocs > 0
        ? `${plural(readyDocs, "document")} ready${failedDocs ? `, ${failedDocs} failed` : ""}`
        : failedDocs
          ? `${plural(failedDocs, "document")} failed. Reprocess or replace them.`
          : "None yet. Add brochures, price lists or FAQs.",
  };

  const projectItem: SetupItem = {
    key: "projects",
    label: "Projects with units",
    href: "/projects",
    done: projectsWithUnits > 0,
    tone: projectsWithUnits > 0 ? "ok" : projects > 0 ? "warn" : "muted",
    detail:
      projects === 0
        ? "No projects yet"
        : `${projectsWithUnits} of ${plural(projects, "project")} ${projectsWithUnits === 1 ? "has" : "have"} units`,
  };

  const slots: SetupItem = {
    key: "slots",
    label: "Viewing slots",
    href: "/projects",
    done: freeSlots > 0,
    tone: freeSlots > 0 ? "ok" : "warn",
    detail: freeSlots > 0 ? `${plural(freeSlots, "free slot")} coming up` : "No free slots coming up, so the bot can't book viewings",
  };

  const flow: SetupItem = {
    key: "flow",
    label: "Scripted flow",
    href: "/flows",
    done: savedFlows > 0,
    tone: savedFlows > 0 ? "ok" : "muted",
    detail: savedFlows > 0 ? "Saved" : "Using the ready-made flow. Review it and save your own.",
  };

  return [ai, storage, knowledge, projectItem, slots, flow];
}

export async function getDashboard(orgId: string, period: Period, now = new Date()): Promise<DashboardData> {
  const { from, to } = periodRange(period, now);
  const inPeriod = { gte: from, lte: to };

  const [org, newLeads, bookings, needingPerson, conversations, runs, personReplies, activeLeads, tokensThisMonth, setup, hot, upcoming] =
    await Promise.all([
      prisma.org.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } }),
      prisma.lead.findMany({
        where: { orgId, createdAt: inPeriod },
        select: {
          score: true,
          status: true,
          createdAt: true,
          _count: { select: { bookings: { where: { status: { not: "cancelled" } } } } },
        },
      }),
      prisma.booking.groupBy({
        by: ["kind"],
        where: { orgId, createdAt: inPeriod, status: { not: "cancelled" } },
        _count: { _all: true },
      }),
      prisma.lead.count({
        where: { orgId, status: { not: "closed" }, conversations: { some: { needsHuman: true, humanTakeover: false } } },
      }),
      prisma.conversation.findMany({
        where: { orgId, createdAt: inPeriod },
        select: { messages: { select: { direction: true, author: true, createdAt: true }, orderBy: { createdAt: "asc" } } },
      }),
      prisma.agentRun.findMany({ where: { orgId, createdAt: inPeriod }, select: { outcome: true, guard: true } }),
      prisma.message.count({ where: { author: "agent", direction: "out", createdAt: inPeriod, conversation: { orgId } } }),
      prisma.lead.findMany({ where: { orgId, updatedAt: inPeriod }, select: { strikes: true, aiStopped: true } }),
      monthTokensUsed(orgId, now),
      setupChecklist(orgId, now),
      prisma.lead.findMany({
        where: { orgId, score: "hot", status: { not: "closed" } },
        orderBy: { updatedAt: "desc" },
        take: LIST_SIZE,
        select: { id: true, name: true, phone: true, scoreReasons: true, updatedAt: true, project: { select: { name: true } } },
      }),
      prisma.booking.findMany({
        where: { orgId, status: "booked", startsAt: { gte: now } },
        orderBy: { startsAt: "asc" },
        take: LIST_SIZE,
        select: {
          id: true,
          kind: true,
          startsAt: true,
          lead: { select: { id: true, name: true } },
          project: { select: { name: true } },
        },
      }),
    ]);

  const score = (s: string) => newLeads.filter((l) => l.score === s).length;
  const qualified = newLeads.filter((l) => isQualified({ status: l.status, activeBookings: l._count.bookings })).length;
  const bookedOf = (kind: string) => bookings.find((b) => b.kind === kind)?._count._all ?? 0;

  const replyTimes = conversations.map((c) => firstReplyMs(c.messages)).filter((t): t is number | null => t !== undefined);
  const tally = tallyRuns(runs.map((r) => ({ outcome: r.outcome, mode: parseJson<{ mode?: string }>(r.guard, {}).mode ?? null })));

  return {
    period,
    from: from.toISOString(),
    to: to.toISOString(),
    leads: {
      new: newLeads.length,
      hot: score("hot"),
      warm: score("warm"),
      cold: score("cold"),
      unknown: newLeads.length - score("hot") - score("warm") - score("cold"),
      qualified,
      qualifiedRate: newLeads.length ? qualified / newLeads.length : null,
      viewingsBooked: bookedOf("viewing"),
      callsBooked: bookedOf("call"),
      needingPerson,
    },
    perBucket: bucketCounts(period, from, to, newLeads.map((l) => l.createdAt)),
    response: summarizeReplies(replyTimes),
    answered: {
      ...tally,
      person: personReplies,
      strikes: activeLeads.reduce((sum, l) => sum + l.strikes, 0),
      leadsWithStrikes: activeLeads.filter((l) => l.strikes > 0).length,
      aiStoppedLeads: activeLeads.filter((l) => l.aiStopped).length,
      tokensThisMonth,
      monthlyBudget: readSettings(org.settings).monthlyTokenBudget,
    },
    setup,
    hotLeads: hot.map((l) => ({
      id: l.id,
      name: l.name,
      phone: l.phone,
      projectName: l.project?.name ?? null,
      reasons: parseStringArray(l.scoreReasons),
      updatedAt: l.updatedAt.toISOString(),
    })),
    upcoming: upcoming.map((b) => ({
      id: b.id,
      leadId: b.lead.id,
      leadName: b.lead.name,
      projectName: b.project?.name ?? null,
      kind: b.kind,
      startsAt: b.startsAt.toISOString(),
    })),
  };
}
