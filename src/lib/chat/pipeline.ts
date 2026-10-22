import type { Connection, Prisma } from "@/generated/prisma/client";
import { findConnection, parseJson, readAiConfig } from "@/lib/connections";
import { prisma } from "@/lib/db";
import { runAgentTurn } from "./agent";
import { advanceFlow, DEFAULT_FLOW, startFlow, type FlowContext } from "./flow";
import { freeChecks } from "./guard";
import { scoreLead } from "./scoring";
import { readSettings } from "./settings";
import { emptyTrace, mergeQualification, nextStatus, runTurn, type OutgoingRecord } from "./turn";
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
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const sum = await prisma.agentRun.aggregate({
    where: { orgId, createdAt: { gte: since } },
    _sum: { inputTokens: true, outputTokens: true },
  });
  return (sum._sum.inputTokens ?? 0) + (sum._sum.outputTokens ?? 0);
}

async function flowContext(orgId: string, projectId: string | null, qualification: Qualification, now: Date): Promise<FlowContext> {
  const [org, project, slots] = await Promise.all([
    prisma.org.findUniqueOrThrow({ where: { id: orgId }, select: { name: true } }),
    projectId ? prisma.project.findFirst({ where: { id: projectId, orgId }, select: { name: true } }) : null,
    prisma.availabilitySlot.findMany({
      where: { orgId, startsAt: { gt: now }, booking: null, ...(projectId ? { OR: [{ projectId }, { projectId: null }] } : {}) },
      orderBy: { startsAt: "asc" },
      take: SLOTS_OFFERED,
      select: { id: true, startsAt: true, kind: true },
    }),
  ]);
  return {
    qualification,
    orgName: org.name,
    projectName: project?.name ?? null,
    slots: slots.map((s) => ({ id: s.id, startsAt: s.startsAt.toISOString(), kind: s.kind })),
  };
}

function readFlowState(raw: string): FlowState | null {
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

function outcomeFor(trace: TurnTrace, handoff: boolean): string {
  if (trace.mode === "human") return "human";
  if (trace.mode === "none") return "blocked";
  if (handoff) return "handoff";
  if (trace.why.includes("fallback")) return trace.error ? "error" : "fallback";
  if (trace.scope === "off_topic" || trace.scope === "abuse") return "off_topic";
  return "replied";
}

// Books a slot the flow or agent chose, unless it's gone. The agent's own tool may have booked it already.
async function book(tx: Prisma.TransactionClient, orgId: string, leadId: string, projectId: string | null, slotId: string) {
  const slot = await tx.availabilitySlot.findFirst({ where: { id: slotId, orgId }, include: { booking: true } });
  if (!slot || slot.booking) return;
  await tx.booking.create({
    data: { orgId, leadId, projectId: slot.projectId ?? projectId, slotId, startsAt: slot.startsAt, kind: slot.kind },
  });
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
      where: { conversationId, direction: "in", createdAt: { gte: new Date(now.getTime() - 60_000) } },
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
      flowContext(orgId, lead.projectId, qualification, now),
    ]);

    const outcome = await runTurn(
      {
        input,
        text,
        settings: readSettings(conv.org.settings),
        forceScripted: conv.forceScripted,
        lead: {
          language,
          qualification,
          status: lead.status,
          strikes: lead.strikes,
          offTopicStreak: lead.offTopicStreak,
          aiStopped: lead.aiStopped,
          tokensUsed: lead.tokensUsed,
          blocked: lead.blocked,
        },
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
      if (outcome.messages.length) await tx.message.createMany({ data: outgoingRows(conversationId, outcome.messages, now) });
      await tx.lead.update({
        where: { id: lead.id },
        data: {
          language: l.language,
          qualification: JSON.stringify(l.qualification),
          status: l.status,
          strikes: l.strikes,
          offTopicStreak: l.offTopicStreak,
          aiStopped: l.aiStopped,
          tokensUsed: l.tokensUsed,
          ...(l.score ? { score: l.score, scoreReasons: JSON.stringify(l.scoreReasons ?? []) } : {}),
        },
      });
      await tx.conversation.update({
        where: { id: conversationId },
        data: {
          ...(outcome.flowState ? { flowState: JSON.stringify(outcome.flowState) } : {}),
          ...(outcome.needsHuman ? { needsHuman: true } : {}),
          updatedAt: new Date(),
        },
      });
      if (outcome.booking) await book(tx, orgId, lead.id, lead.projectId, outcome.booking.slotId);
      await tx.agentRun.create({ data: runRow(orgId, conversationId, outcome.trace, ai, outcomeFor(outcome.trace, outcome.needsHuman)) });
    });
    return getConversationView(orgId, conversationId);
  });
}

/** Creates a test lead and conversation, and sends the flow's greeting and first question. */
export async function startConversation(orgId: string, req: StartConversationRequest): Promise<ConversationView> {
  const now = new Date();
  const flow = await loadFlow(orgId);
  const ctx = await flowContext(orgId, req.projectId, {}, now);
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

/** A person's reply while they have taken over the conversation. */
export async function sendAgentReply(orgId: string, conversationId: string, text: string): Promise<ConversationView | null> {
  return serialize(conversationId, async () => {
    const conv = await prisma.conversation.findFirst({ where: { id: conversationId, orgId }, select: { id: true } });
    if (!conv) return null;
    await prisma.$transaction([
      prisma.message.create({ data: { conversationId, direction: "out", author: "agent", kind: "text", body: text, payload: "{}" } }),
      prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } }),
    ]);
    return getConversationView(orgId, conversationId);
  });
}
