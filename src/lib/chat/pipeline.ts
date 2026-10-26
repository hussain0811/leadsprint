import type { Connection, Prisma } from "@/generated/prisma/client";
import { findConnection, parseJson, readAiConfig } from "@/lib/connections";
import { prisma } from "@/lib/db";
import { runAgentTurn } from "./agent";
import { advanceFlow, DEFAULT_FLOW, formatSlot, startFlow, type FlowContext } from "./flow";
import { freeChecks } from "./guard";
import { scoreLead } from "./scoring";
import { readSettings } from "./settings";
import {
  asUnsentNotes,
  counterUpdate,
  dubaiMonthStart,
  emptyTrace,
  mergeQualification,
  nextStatus,
  replyForFailedBooking,
  runTurn,
  type BookResult,
  type OutgoingRecord,
  type TurnLead,
} from "./turn";
import type { ConversationView, FlowDefinition, FlowState, InboundInput, Lang, Qualification, StartConversationRequest, TurnTrace } from "./types";
import { getConversationView, messageColumns, runColumns } from "./views";

// Runs the bot for the simulator: loads what a turn needs, lets turn.ts decide, saves the result.

const SLOTS_OFFERED = 5;

/** The org's saved flow, or the ready-made one when none is saved (or it can't be read). */
export async function loadFlow(orgId: string): Promise<FlowDefinition> {
  const row = await prisma.flow.findFirst({ where: { orgId }, orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }] });
  const def = row && parseJson<FlowDefinition | null>(row.definition, null);
  return def && typeof def === "object" && Array.isArray(def.steps) ? def : DEFAULT_FLOW;
}

/** Why the AI can't answer, or null when the AI connection is ready. */
export function aiUnavailable(row: Connection | null): string | null {
  if (!row) return "No AI connection";
  if (!row.enabled) return "AI connection is turned off";
  if (!readAiConfig(row)) return "AI connection settings are incomplete";
  if (row.status === "error") return "AI connection failed its last check";
  if (row.status === "warning") return "AI connection isn't ready: it failed a required check in Connections";
  if (row.status !== "ok") return "AI connection hasn't been checked yet";
  return null;
}

export async function monthTokensUsed(orgId: string, now = new Date()): Promise<number> {
  const since = dubaiMonthStart(now);
  const sum = await prisma.agentRun.aggregate({
    where: { orgId, createdAt: { gte: since } },
    _sum: { inputTokens: true, outputTokens: true },
  });
  return (sum._sum.inputTokens ?? 0) + (sum._sum.outputTokens ?? 0);
}

function freeSlots(db: Prisma.TransactionClient, orgId: string, projectId: string | null, now: Date) {
  return db.availabilitySlot.findMany({
    where: { orgId, startsAt: { gt: now }, booking: null, ...(projectId ? { OR: [{ projectId }, { projectId: null }] } : {}) },
    orderBy: { startsAt: "asc" },
    take: SLOTS_OFFERED,
    select: { id: true, startsAt: true, kind: true },
  });
}

async function flowContext(
  orgId: string,
  projectId: string | null,
  qualification: Qualification,
  now: Date,
  leadId: string | null,
): Promise<FlowContext> {
  const [org, project, slots, booked] = await Promise.all([
    prisma.org.findUniqueOrThrow({ where: { id: orgId }, select: { name: true } }),
    projectId ? prisma.project.findFirst({ where: { id: projectId, orgId }, select: { name: true } }) : null,
    freeSlots(prisma, orgId, projectId, now),
    // A lead with an upcoming booking isn't offered slots again when the flow resumes.
    leadId ? prisma.booking.count({ where: { leadId, status: "booked", startsAt: { gt: now } } }) : 0,
  ]);
  return {
    qualification,
    orgName: org.name,
    projectName: project?.name ?? null,
    slots: slots.map((s) => ({ id: s.id, startsAt: s.startsAt.toISOString(), kind: s.kind })),
    hasBooking: booked > 0,
  };
}

export function readFlowState(raw: string): FlowState | null {
  const s = parseJson<Partial<FlowState>>(raw, {});
  if (!s || (s.stepId !== null && typeof s.stepId !== "string")) return null;
  return { stepId: s.stepId, lang: s.lang === "ar" ? "ar" : "en", retries: typeof s.retries === "number" ? s.retries : 0 };
}

// Gives each saved message its own millisecond so the order on screen matches the order sent.
function stamps(count: number, after: Date): Date[] {
  const base = Math.max(Date.now(), after.getTime() + 1);
  return Array.from({ length: count }, (_, i) => new Date(base + i));
}

function outgoingRows(conversationId: string, messages: OutgoingRecord[], after: Date): Prisma.MessageCreateManyInput[] {
  const at = stamps(messages.length, after);
  return messages.map((m, i) => ({ conversationId, direction: "out", author: m.author, ...messageColumns(m.message), createdAt: at[i] }));
}

function runRow(orgId: string, conversationId: string, trace: TurnTrace, ai: { provider: string; model: string } | null, outcome: string) {
  return { orgId, conversationId, provider: ai?.provider ?? trace.mode, model: ai?.model ?? "", outcome, ...runColumns(trace) };
}

// The agent reads "blocked" and "off_topic" to keep guarded messages out of the model's history,
// so those win over handoff and fallback.
function outcomeFor(trace: TurnTrace, handoff: boolean): string {
  if (trace.mode === "human") return "human";
  if (trace.mode === "none") return "blocked";
  if (trace.scope === "off_topic" || trace.scope === "abuse") return "off_topic";
  if (handoff) return "handoff";
  // A scripted turn with AI tokens is a fallback after the AI tried.
  if (trace.mode === "scripted" && trace.tokens !== null) return trace.error ? "error" : "fallback";
  return "replied";
}

/**
 * Books a slot the flow or agent chose. The agent's own tool may have booked it for this lead already,
 * which counts as booked. Refused when the slot is gone or someone else has it, and when the lead
 * already has another upcoming booking.
 */
async function book(
  tx: Prisma.TransactionClient,
  orgId: string,
  leadId: string,
  projectId: string | null,
  slotId: string,
  lang: Lang,
  now: Date,
): Promise<BookResult> {
  const slot = await tx.availabilitySlot.findFirst({ where: { id: slotId, orgId }, include: { booking: true } });
  if (slot?.booking?.leadId === leadId && slot.booking.status === "booked") return { ok: true };
  if (!slot || slot.booking || slot.startsAt <= now) return { ok: false, reason: "taken" };
  const existing = await tx.booking.findFirst({
    where: { leadId, status: "booked", startsAt: { gt: now } },
    orderBy: { startsAt: "asc" },
    select: { startsAt: true },
  });
  if (existing) return { ok: false, reason: "already_booked", existingAt: formatSlot(existing.startsAt.toISOString(), lang) };
  try {
    await tx.booking.create({
      data: { orgId, leadId, projectId: slot.projectId ?? projectId, slotId, startsAt: slot.startsAt, kind: slot.kind },
    });
    return { ok: true };
  } catch (err) {
    // Booking.slotId is unique: another lead booked this slot between the check and the insert.
    // (SQLite keeps the transaction usable after a failed insert.)
    if ((err as { code?: string }).code === "P2002") return { ok: false, reason: "taken" };
    throw err;
  }
}

// One turn at a time per conversation, so two quick messages can't both read the same flow position.
const queues = new Map<string, Promise<unknown>>();
function serialize<T>(key: string, work: () => Promise<T>): Promise<T> {
  const run = (queues.get(key) ?? Promise.resolve()).then(work, work);
  const tail = run.catch(() => undefined);
  queues.set(key, tail);
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return run;
}

/** Text to show for an inbound message: what was typed, else the title of the tapped option. */
async function inboundText(conversationId: string, input: InboundInput): Promise<string> {
  if (input.text?.trim()) return input.text.trim();
  if (!input.replyId) return "";
  const recent = await prisma.message.findMany({
    where: { conversationId, direction: "out", kind: { in: ["buttons", "list"] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 5,
    select: { payload: true },
  });
  for (const m of recent) {
    const p = parseJson<{ buttons?: Array<{ id: string; title: string }>; rows?: Array<{ id: string; title: string }> }>(m.payload, {});
    const hit = [...(p.buttons ?? []), ...(p.rows ?? [])].find((o) => o.id === input.replyId);
    if (hit) return hit.title;
  }
  return input.replyId;
}

/** Saves a lead's message, runs the bot's turn, and returns the conversation as it now stands. */
export function handleInbound(orgId: string, conversationId: string, input: InboundInput): Promise<ConversationView | null> {
  return serialize(conversationId, async () => {
    const conv = await prisma.conversation.findFirst({ where: { id: conversationId, orgId }, include: { lead: true, org: true } });
    if (!conv) return null;
    const lead = conv.lead;
    const now = new Date();
    const text = await inboundText(conversationId, input);

    const recent = await prisma.message.findMany({
      // Taps on buttons and list rows don't count towards the rate limit.
      where: { conversationId, direction: "in", createdAt: { gte: new Date(now.getTime() - 60_000) }, NOT: { payload: { contains: "\"replyId\"" } } },
      select: { createdAt: true },
    });
    await prisma.$transaction([
      prisma.message.create({
        data: { conversationId, direction: "in", author: "lead", kind: "text", body: text, payload: JSON.stringify(input.replyId ? { replyId: input.replyId } : {}), createdAt: now },
      }),
      prisma.conversation.update({ where: { id: conversationId }, data: { lastInboundAt: now } }),
    ]);

    if (conv.humanTakeover) {
      const trace = emptyTrace("human", "A person has taken over this conversation");
      await prisma.agentRun.create({ data: runRow(orgId, conversationId, trace, null, outcomeFor(trace, false)) });
      return getConversationView(orgId, conversationId);
    }

    const qualification = parseJson<Qualification>(lead.qualification, {});
    const language: Lang = lead.language === "ar" ? "ar" : "en";
    const [aiRow, monthUsed, flow, ctx] = await Promise.all([
      findConnection(orgId, "ai"),
      monthTokensUsed(orgId, now),
      loadFlow(orgId),
      flowContext(orgId, lead.projectId, qualification, now, lead.id),
    ]);

    const settings = readSettings(conv.org.settings);
    const turnLead: TurnLead = {
      language,
      qualification,
      status: lead.status,
      strikes: lead.strikes,
      offTopicStreak: lead.offTopicStreak,
      aiStopped: lead.aiStopped,
      tokensUsed: lead.tokensUsed,
      blocked: lead.blocked,
    };
    const outcome = await runTurn(
      {
        input,
        text,
        settings,
        forceScripted: conv.forceScripted,
        lead: turnLead,
        recentInboundAt: recent.map((m) => m.createdAt),
        aiUnavailable: aiUnavailable(aiRow),
        monthTokensUsed: monthUsed,
        flow,
        flowState: readFlowState(conv.flowState),
        flowCtx: ctx,
        now,
      },
      {
        freeChecks,
        advanceFlow,
        scoreLead,
        runAgent: (agentInput, lang) => runAgentTurn({ orgId, conversationId, input: agentInput, lang }),
      },
    );

    const aiConfig = aiRow && readAiConfig(aiRow);
    const usedAi = outcome.trace.mode === "ai" || outcome.trace.tokens !== null;
    const ai = usedAi && aiRow && aiConfig ? { provider: aiRow.provider, model: aiConfig.chatModel } : null;
    const l = outcome.lead;
    await prisma.$transaction(async (tx) => {
      // The turn may have taken a while (AI calls): act on the conversation as it is now.
      const fresh = await tx.conversation.findUniqueOrThrow({
        where: { id: conversationId },
        select: { humanTakeover: true, forceScripted: true, lead: { select: { status: true, blocked: true } } },
      });
      const unsent = fresh.humanTakeover ? "a person took over" : fresh.lead.blocked ? "the lead was blocked" : null;
      let messages = unsent ? asUnsentNotes(outcome.messages, unsent) : outcome.messages;
      let flowState = outcome.flowState;
      const trace = { ...outcome.trace };
      if (unsent) trace.why = `${trace.why} (reply not sent: ${unsent})`;
      else if (fresh.forceScripted && !conv.forceScripted && outcome.trace.mode === "ai") trace.why = `${trace.why} (scripted mode was turned on during this turn)`;

      let booked = false;
      if (outcome.booking && !unsent) {
        const result = await book(tx, orgId, lead.id, lead.projectId, outcome.booking.slotId, l.language, now);
        booked = result.ok;
        if (!result.ok) {
          const slots = (await freeSlots(tx, orgId, lead.projectId, now)).map((s) => ({ id: s.id, title: formatSlot(s.startsAt.toISOString(), l.language), description: s.kind }));
          messages = replyForFailedBooking(messages, result, l.language, slots);
          // A taken slot asks the same question again, without counting a retry.
          if (result.reason === "taken" && outcome.flowStateBefore?.stepId) flowState = { ...outcome.flowStateBefore, lang: l.language };
          trace.why = `${trace.why} (booking refused: ${result.reason === "taken" ? "slot just taken" : "lead already has a booking"})`;
        }
      }

      if (messages.length) await tx.message.createMany({ data: outgoingRows(conversationId, messages, now) });
      const flags = outcome.statusFlags;
      const updated = await tx.lead.update({
        where: { id: lead.id },
        data: {
          language: l.language,
          qualification: JSON.stringify(l.qualification),
          ...(flags ? { status: nextStatus(fresh.lead.status, { ...flags, booked: booked || (flags.booked && !outcome.booking) }) } : {}),
          ...counterUpdate(turnLead, l),
          ...(l.score ? { score: l.score, scoreReasons: JSON.stringify(l.scoreReasons ?? []) } : {}),
        },
        select: { strikes: true, aiStopped: true },
      });
      if (!updated.aiStopped && updated.strikes >= settings.strikeLimit) {
        await tx.lead.update({ where: { id: lead.id }, data: { aiStopped: true } });
      }
      await tx.conversation.update({
        where: { id: conversationId },
        data: {
          ...(flowState ? { flowState: JSON.stringify(flowState) } : {}),
          ...(outcome.needsHuman ? { needsHuman: true } : {}),
          updatedAt: new Date(),
        },
      });
      await tx.agentRun.create({ data: runRow(orgId, conversationId, trace, ai, outcomeFor(trace, outcome.needsHuman)) });
    });
    return getConversationView(orgId, conversationId);
  });
}

/** Creates a test lead and conversation, and sends the flow's greeting and first question. */
export async function startConversation(orgId: string, req: StartConversationRequest): Promise<ConversationView> {
  const now = new Date();
  const flow = await loadFlow(orgId);
  const ctx = await flowContext(orgId, req.projectId, {}, now, null);
  // Run the flow before saving anything, so a broken flow leaves no half-made lead behind.
  const started = Date.now();
  const result = startFlow(flow, req.language, ctx);
  const qualification = mergeQualification({}, result.patch);
  const scored = scoreLead(qualification);
  const trace: TurnTrace = { ...emptyTrace("scripted", "Conversation started: greeting and first question"), ms: Date.now() - started };

  const conversationId = await prisma.$transaction(async (tx) => {
    const lead = await tx.lead.create({
      data: {
        orgId,
        projectId: req.projectId,
        name: req.name || null,
        phone: req.phone || null,
        source: "simulator",
        language: result.state.lang,
        status: nextStatus("new", { handoff: result.handoff, finished: false, booked: false }),
        qualification: JSON.stringify(qualification),
        score: scored.score,
        scoreReasons: JSON.stringify(scored.reasons),
      },
    });
    const conv = await tx.conversation.create({
      data: { orgId, leadId: lead.id, flowState: JSON.stringify(result.state), needsHuman: result.handoff },
    });
    const messages: OutgoingRecord[] = result.messages.map((message) => ({ author: message.kind === "note" ? "system" : "bot", message }));
    if (messages.length) await tx.message.createMany({ data: outgoingRows(conv.id, messages, now) });
    await tx.agentRun.create({ data: runRow(orgId, conv.id, trace, null, "replied") });
    return conv.id;
  });
  return (await getConversationView(orgId, conversationId))!;
}

/** A person's reply while they have taken over the conversation; refused when they haven't (checked in the queue). */
export async function sendAgentReply(
  orgId: string,
  conversationId: string,
  text: string,
): Promise<{ ok: true; view: ConversationView | null } | { ok: false; reason: "not_found" | "not_taken_over" }> {
  return serialize(conversationId, async () => {
    const conv = await prisma.conversation.findFirst({ where: { id: conversationId, orgId }, select: { humanTakeover: true } });
    if (!conv) return { ok: false as const, reason: "not_found" as const };
    if (!conv.humanTakeover) return { ok: false as const, reason: "not_taken_over" as const };
    await prisma.$transaction([
      prisma.message.create({ data: { conversationId, direction: "out", author: "agent", kind: "text", body: text, payload: "{}" } }),
      prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } }),
    ]);
    return { ok: true as const, view: await getConversationView(orgId, conversationId) };
  });
}
