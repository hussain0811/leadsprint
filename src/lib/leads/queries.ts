import type { Prisma } from "@/generated/prisma/client";
import type { Qualification, Score } from "@/lib/chat/types";
import { aiUnavailable } from "@/lib/chat/pipeline";
import { findConnection, parseJson } from "@/lib/connections";
import { answeringMode } from "@/lib/inbox/filters";
import { prisma } from "@/lib/db";
import { compareByScore, pageCount, phoneMatches, phoneSearchDigits } from "./filters";
import { keyAnswers } from "./present";
import { PAGE_SIZE, SCORES, type BookingView, type LeadDetail, type LeadFilters, type LeadListResponse, type LeadRow } from "./types";

// Database reads for the Leads pages. Server only.

// Stored JSON is checked in code; anything that isn't the expected shape reads as empty.
function qualificationOf(raw: string | null | undefined): Qualification {
  const q = parseJson<unknown>(raw, {});
  return q && typeof q === "object" && !Array.isArray(q) ? (q as Qualification) : {};
}

function reasonsOf(raw: string | null | undefined): string[] {
  const r = parseJson<unknown>(raw, []);
  return Array.isArray(r) ? r.filter((x): x is string => typeof x === "string") : [];
}

function toScore(score: string): Score {
  return SCORES.includes(score as Score) ? (score as Score) : "unknown";
}

/** The Prisma filter for everything except the phone-digit search, which SQLite can't do in a query. */
async function leadWhere(orgId: string, f: LeadFilters): Promise<Prisma.LeadWhereInput> {
  const where: Prisma.LeadWhereInput = { orgId };
  if (f.score) where.score = f.score;
  if (f.status) where.status = f.status;
  if (f.projectId === "none") where.projectId = null;
  else if (f.projectId) where.projectId = f.projectId;
  if (f.needsPerson) where.conversations = { some: { needsHuman: true } };

  if (f.q) {
    // SQLite's LIKE ignores case for Latin letters; Arabic has no case.
    const or: Prisma.LeadWhereInput[] = [{ name: { contains: f.q } }, { phone: { contains: f.q } }];
    const digits = phoneSearchDigits(f.q);
    if (digits) {
      // Phones are stored as typed ("+971 50 123 4567"), so compare digits only.
      const phones = await prisma.lead.findMany({ where: { ...where, phone: { not: null } }, select: { id: true, phone: true } });
      const ids = phones.filter((p) => phoneMatches(p.phone, digits)).map((p) => p.id);
      if (ids.length) or.push({ id: { in: ids } });
    }
    where.OR = or;
  }
  return where;
}

const rowInclude = {
  project: { select: { name: true } },
  conversations: { select: { needsHuman: true, updatedAt: true }, orderBy: { updatedAt: "desc" } },
  bookings: {
    where: { status: "booked" },
    orderBy: { startsAt: "asc" },
    include: { project: { select: { name: true } } },
  },
} satisfies Prisma.LeadInclude;

type RowSource = Prisma.LeadGetPayload<{ include: typeof rowInclude }>;

function toBookingView(b: { id: string; startsAt: Date; kind: string; status: string; project: { name: string } | null }): BookingView {
  return { id: b.id, startsAt: b.startsAt.toISOString(), kind: b.kind, status: b.status, projectName: b.project?.name ?? null };
}

function lastActivity(lead: { updatedAt: Date }, conversations: Array<{ updatedAt: Date }>): string {
  const times = [lead.updatedAt.getTime(), ...conversations.map((c) => c.updatedAt.getTime())];
  return new Date(Math.max(...times)).toISOString();
}

function toRow(lead: RowSource, now: Date): LeadRow {
  // The next upcoming booking; a past one that was never marked done still shows until it's handled.
  const upcoming = lead.bookings.find((b) => b.startsAt >= now) ?? lead.bookings[lead.bookings.length - 1] ?? null;
  return {
    id: lead.id,
    name: lead.name,
    phone: lead.phone,
    projectId: lead.projectId,
    projectName: lead.project?.name ?? null,
    score: toScore(lead.score),
    status: lead.status,
    keyAnswers: keyAnswers(qualificationOf(lead.qualification)),
    needsPerson: lead.conversations.some((c) => c.needsHuman),
    nextBooking: upcoming && toBookingView(upcoming),
    source: lead.source,
    lastActivityAt: lastActivity(lead, lead.conversations),
    createdAt: lead.createdAt.toISOString(),
  };
}

/** Ids of every matching lead, in list order. Sorting by score needs a custom order, so it's done here. */
async function orderedIds(orgId: string, f: LeadFilters): Promise<string[]> {
  const where = await leadWhere(orgId, f);
  const rows = await prisma.lead.findMany({
    where,
    select: { id: true, score: true, createdAt: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  if (f.sort === "score") rows.sort(compareByScore);
  return rows.map((r) => r.id);
}

async function rowsFor(ids: string[]): Promise<LeadRow[]> {
  if (!ids.length) return [];
  const leads = await prisma.lead.findMany({ where: { id: { in: ids } }, include: rowInclude });
  const byId = new Map(leads.map((l) => [l.id, l]));
  const now = new Date();
  return ids.flatMap((id) => {
    const lead = byId.get(id);
    return lead ? [toRow(lead, now)] : [];
  });
}

export async function listLeads(orgId: string, f: LeadFilters): Promise<LeadListResponse> {
  const [ids, projects] = await Promise.all([
    orderedIds(orgId, f),
    prisma.project.findMany({ where: { orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const pages = pageCount(ids.length, PAGE_SIZE);
  const page = Math.min(f.page, pages);
  const leads = await rowsFor(ids.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE));
  return { leads, total: ids.length, page, pageCount: pages, projects };
}

/** Every matching lead (no paging), for the CSV export, with the extra columns it carries. */
export async function exportLeads(orgId: string, f: LeadFilters) {
  const ids = await orderedIds(orgId, f);
  const rows = await rowsFor(ids);
  const extra = await prisma.lead.findMany({
    where: { id: { in: ids } },
    select: { id: true, email: true, language: true, scoreReasons: true, qualification: true, summary: true },
  });
  const byId = new Map(extra.map((e) => [e.id, e]));
  return rows.map((row) => {
    const e = byId.get(row.id);
    return {
      row,
      email: e?.email ?? null,
      language: e?.language ?? "en",
      scoreReasons: reasonsOf(e?.scoreReasons),
      qualification: qualificationOf(e?.qualification),
      summary: e?.summary ?? null,
    };
  });
}

export async function getLeadDetail(orgId: string, id: string): Promise<LeadDetail | null> {
  const lead = await prisma.lead.findFirst({
    where: { id, orgId },
    include: {
      project: { select: { name: true } },
      bookings: { orderBy: { startsAt: "desc" }, include: { project: { select: { name: true } } } },
      conversations: {
        orderBy: { updatedAt: "desc" },
        select: { id: true, channel: true, forceScripted: true, needsHuman: true, humanTakeover: true, updatedAt: true, _count: { select: { messages: true } } },
      },
    },
  });
  if (!lead) return null;
  const aiProblem = aiUnavailable(await findConnection(orgId, "ai"));
  const conv = lead.conversations[0];
  const answering = conv
    ? answeringMode({ humanTakeover: conv.humanTakeover, forceScripted: conv.forceScripted, aiStopped: lead.aiStopped, aiReady: aiProblem === null })
    : null;
  const answeringWhy =
    answering !== "scripted"
      ? null
      : conv.forceScripted
        ? "Set to scripted only for this chat"
        : lead.aiStopped
          ? "AI stopped for this lead after too many strikes"
          : aiProblem;
  return {
    id: lead.id,
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    projectId: lead.projectId,
    projectName: lead.project?.name ?? null,
    source: lead.source,
    language: lead.language,
    status: lead.status,
    score: toScore(lead.score),
    scoreReasons: reasonsOf(lead.scoreReasons),
    qualification: qualificationOf(lead.qualification),
    summary: lead.summary,
    strikes: lead.strikes,
    aiStopped: lead.aiStopped,
    blocked: lead.blocked,
    tokensUsed: lead.tokensUsed,
    needsPerson: lead.conversations.some((c) => c.needsHuman),
    answering,
    answeringWhy,
    createdAt: lead.createdAt.toISOString(),
    lastActivityAt: lastActivity(lead, lead.conversations),
    bookings: lead.bookings.map(toBookingView),
    conversations: lead.conversations.map((c) => ({
      id: c.id,
      channel: c.channel,
      forceScripted: c.forceScripted,
      needsHuman: c.needsHuman,
      humanTakeover: c.humanTakeover,
      messageCount: c._count.messages,
      updatedAt: c.updatedAt.toISOString(),
    })),
  };
}
