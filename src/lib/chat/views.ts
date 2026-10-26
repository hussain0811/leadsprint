import type { AgentRun, Message } from "@/generated/prisma/client";
import { parseJson } from "@/lib/connections";
import { prisma } from "@/lib/db";
import type {
  ConversationSummary,
  ConversationView,
  Lang,
  MessageView,
  OutgoingMessage,
  Qualification,
  Score,
  TurnTrace,
} from "./types";

// Database rows -> the shapes the Chat tester reads. The last turn's trace lives on the newest
// AgentRun row for the conversation (one row per lead message, scripted turns included).

const WINDOW_MS = 24 * 60 * 60 * 1000;
const SCORES: Score[] = ["hot", "warm", "cold", "unknown"];
const AUTHORS: MessageView["author"][] = ["lead", "bot", "ai", "agent", "system"];

/** Splits an outgoing message into the Message row's kind, body and payload columns. */
export function messageColumns(message: OutgoingMessage): { kind: string; body: string; payload: string } {
  const { kind, body, ...rest } = message;
  return { kind, body, payload: JSON.stringify(rest) };
}

export function toMessageView(row: Pick<Message, "id" | "direction" | "author" | "kind" | "body" | "payload" | "createdAt">): MessageView {
  const extra = parseJson<Record<string, unknown>>(row.payload, {});
  let message: OutgoingMessage;
  if (row.direction === "in") message = { kind: "text", body: row.body };
  else if (row.kind === "buttons" && Array.isArray(extra.buttons)) message = { kind: "buttons", body: row.body, buttons: extra.buttons };
  else if (row.kind === "list" && Array.isArray(extra.rows))
    message = { kind: "list", body: row.body, buttonLabel: String(extra.buttonLabel ?? ""), rows: extra.rows };
  else if (row.kind === "document" && extra.document && typeof extra.document === "object")
    message = { kind: "document", body: row.body, document: extra.document as Extract<OutgoingMessage, { kind: "document" }>["document"] };
  else if (row.kind === "note") message = { kind: "note", body: row.body };
  else message = { kind: "text", body: row.body };
  return {
    id: row.id,
    direction: row.direction === "in" ? "in" : "out",
    author: AUTHORS.includes(row.author as MessageView["author"]) ? (row.author as MessageView["author"]) : "system",
    message,
    createdAt: row.createdAt.toISOString(),
  };
}

// What AgentRun.guard holds besides the columns that already have a home.
type StoredGuard = Pick<TurnTrace, "mode" | "why" | "freeCheck" | "scope" | "replyCheck">;

export function runColumns(trace: TurnTrace) {
  const guard: StoredGuard = { mode: trace.mode, why: trace.why, freeCheck: trace.freeCheck, scope: trace.scope, replyCheck: trace.replyCheck };
  return {
    inputTokens: trace.tokens?.input ?? 0,
    outputTokens: trace.tokens?.output ?? 0,
    latencyMs: Math.round(trace.ms),
    guard: JSON.stringify({ ...guard, hasTokens: trace.tokens !== null }),
    toolCalls: JSON.stringify(trace.toolCalls),
    knowledgeUsed: JSON.stringify(trace.passages),
    error: trace.error,
  };
}

export function traceFromRun(run: AgentRun): TurnTrace {
  const guard = parseJson<Partial<StoredGuard> & { hasTokens?: boolean }>(run.guard, {});
  return {
    mode: guard.mode ?? "none",
    why: guard.why ?? "",
    freeCheck: guard.freeCheck ?? { ok: true },
    scope: guard.scope ?? null,
    toolCalls: parseJson(run.toolCalls, []),
    passages: parseJson(run.knowledgeUsed, []),
    replyCheck: guard.replyCheck ?? null,
    tokens: guard.hasTokens ? { input: run.inputTokens, output: run.outputTokens } : null,
    ms: run.latencyMs,
    error: run.error,
  };
}

export async function getConversationView(orgId: string, id: string): Promise<ConversationView | null> {
  const conv = await prisma.conversation.findFirst({
    where: { id, orgId },
    include: {
      lead: { include: { project: { select: { name: true } } } },
      messages: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      agentRuns: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 },
    },
  });
  if (!conv) return null;
  const lead = conv.lead;
  // The next upcoming booking; failing that, the latest past one.
  const now = new Date();
  const select = { startsAt: true, kind: true } as const;
  const booking =
    (await prisma.booking.findFirst({ where: { leadId: lead.id, status: "booked", startsAt: { gte: now } }, orderBy: { startsAt: "asc" }, select })) ??
    (await prisma.booking.findFirst({ where: { leadId: lead.id, status: "booked" }, orderBy: { startsAt: "desc" }, select }));
  return {
    id: conv.id,
    lead: {
      id: lead.id,
      name: lead.name,
      phone: lead.phone,
      projectId: lead.projectId,
      projectName: lead.project?.name ?? null,
      language: (lead.language === "ar" ? "ar" : "en") as Lang,
      status: lead.status,
      score: SCORES.includes(lead.score as Score) ? (lead.score as Score) : "unknown",
      scoreReasons: parseJson<string[]>(lead.scoreReasons, []),
      qualification: parseJson<Qualification>(lead.qualification, {}),
      summary: lead.summary,
      strikes: lead.strikes,
      aiStopped: lead.aiStopped,
      tokensUsed: lead.tokensUsed,
      booking: booking && { startsAt: booking.startsAt.toISOString(), kind: booking.kind },
    },
    forceScripted: conv.forceScripted,
    humanTakeover: conv.humanTakeover,
    needsHuman: conv.needsHuman,
    windowOpenUntil: conv.lastInboundAt ? new Date(conv.lastInboundAt.getTime() + WINDOW_MS).toISOString() : null,
    messages: conv.messages.map(toMessageView),
    lastTrace: conv.agentRuns[0] ? traceFromRun(conv.agentRuns[0]) : null,
  };
}

export async function listConversations(orgId: string): Promise<ConversationSummary[]> {
  const rows = await prisma.conversation.findMany({
    where: { orgId },
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: {
      lead: { select: { name: true, project: { select: { name: true } } } },
      messages: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { body: true } },
    },
  });
  return rows.map((c) => ({
    id: c.id,
    leadName: c.lead.name,
    projectName: c.lead.project?.name ?? null,
    updatedAt: c.updatedAt.toISOString(),
    lastMessage: c.messages[0]?.body ?? "",
  }));
}
