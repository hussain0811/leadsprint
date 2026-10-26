import { prisma } from "@/lib/db";
import { searchKnowledge } from "@/lib/knowledge/search";
import type { OutgoingMessage, Qualification, TurnTrace } from "../types";
import { parseToolCall } from "./tools";

// Runs the agent's tool calls against the database, always scoped to the conversation's org.

const MAX_PASSAGES = 5;
const MAX_LISTINGS = 8;
const MAX_SLOTS = 6;
const MAX_DOCUMENTS_PER_TURN = 3;
const PASSAGE_CHARS = 1_500;

export type KnowledgeUsed = { id: string; sourceId: string | null; origin: "document" | "qa"; title: string; page: number | null };

export type ToolContext = {
  orgId: string;
  leadId: string;
  projectId: string | null;
  now: Date;
};

// What the tools did this turn, gathered for the result and the AgentRun row.
export type TurnState = {
  patch: Partial<Qualification>;
  booking: { slotId: string } | null;
  handoff: boolean;
  handoffReason: string | null;
  documents: Extract<OutgoingMessage, { kind: "document" }>[];
  passages: TurnTrace["passages"];
  knowledgeUsed: KnowledgeUsed[];
  toolCalls: TurnTrace["toolCalls"];
  factTexts: string[]; // tool output this turn, for the reply check's known numbers
  embeddingTokens: number; // tokens spent embedding search questions, when the search reports them
};

export function newTurnState(): TurnState {
  return { patch: {}, booking: null, handoff: false, handoffReason: null, documents: [], passages: [], knowledgeUsed: [], toolCalls: [], factTexts: [], embeddingTokens: 0 };
}

const dubaiTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Dubai",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
export const formatDubai = (date: Date) => `${dubaiTime.format(date)} (Dubai time)`;

/** Runs one tool call and returns the content for the tool message. Never throws. */
export async function runTool(ctx: ToolContext, state: TurnState, name: string, rawArgs: string): Promise<string> {
  const call = parseToolCall(name, rawArgs);
  let output: unknown;
  if (!call.ok) {
    output = { error: call.error };
  } else {
    try {
      output = await execute(ctx, state, call);
    } catch (err) {
      console.error(`Agent tool ${name} failed`, err);
      output = { error: "The tool failed. Try again once, or hand off to a person." };
    }
  }
  let input: unknown = rawArgs;
  try {
    input = rawArgs?.trim() ? JSON.parse(rawArgs) : {};
  } catch {
    // keep the raw text
  }
  state.toolCalls.push({ name, input, output });
  const content = JSON.stringify(output);
  state.factTexts.push(content);
  return content;
}

type Call = Extract<ReturnType<typeof parseToolCall>, { ok: true }>;

async function execute(ctx: ToolContext, state: TurnState, call: Call): Promise<unknown> {
  switch (call.name) {
    case "search_knowledge": {
      const result = await searchKnowledge({ orgId: ctx.orgId, projectId: ctx.projectId, query: call.args.query, limit: MAX_PASSAGES, now: ctx.now });
      state.embeddingTokens += embeddingUsage(result);
      for (const p of result.passages) {
        if (!state.knowledgeUsed.some((k) => k.id === p.id)) {
          state.knowledgeUsed.push({ id: p.id, sourceId: p.sourceId, origin: p.origin, title: p.title, page: p.page });
          state.passages.push({ title: p.title, page: p.page });
        }
      }
      if (result.passages.length === 0) return { passages: [], note: "Nothing found. Don't guess: say a colleague will follow up, and hand off if the lead needs this answered." };
      return {
        passages: result.passages.map((p) => ({
          source: p.title,
          page: p.page,
          ...(p.heading ? { heading: p.heading } : {}),
          text: p.text.length > PASSAGE_CHARS ? `${p.text.slice(0, PASSAGE_CHARS)}…` : p.text,
        })),
      };
    }

    case "search_listings": {
      const { bedrooms, min_price, max_price, type } = call.args;
      const units = await prisma.unit.findMany({
        where: {
          orgId: ctx.orgId,
          status: "available",
          ...(ctx.projectId ? { projectId: ctx.projectId } : {}),
          ...(bedrooms !== undefined ? { bedrooms } : {}),
          ...(type && type !== "any" ? { type } : {}),
          ...(min_price !== undefined || max_price !== undefined
            ? { price: { ...(min_price !== undefined ? { gte: min_price } : {}), ...(max_price !== undefined ? { lte: max_price } : {}) } }
            : {}),
        },
        orderBy: [{ price: "asc" }, { unitNo: "asc" }],
        take: MAX_LISTINGS,
        select: { unitNo: true, type: true, bedrooms: true, sizeSqft: true, price: true, currency: true, floor: true, view: true, project: { select: { name: true } } },
      });
      if (units.length === 0) return { units: [], note: "No available units match. Offer to widen the search or hand off." };
      return {
        units: units.map((u) => ({
          project: u.project.name,
          unit: u.unitNo,
          type: u.type,
          bedrooms: u.bedrooms === 0 ? "studio" : u.bedrooms,
          ...(u.sizeSqft ? { sizeSqft: u.sizeSqft } : {}),
          price: u.price,
          currency: u.currency,
          ...(u.floor ? { floor: u.floor } : {}),
          ...(u.view ? { view: u.view } : {}),
        })),
      };
    }

    case "save_qualification": {
      Object.assign(state.patch, call.args);
      return { saved: call.args };
    }

    case "list_slots": {
      const slots = await prisma.availabilitySlot.findMany({
        where: {
          orgId: ctx.orgId,
          startsAt: { gt: ctx.now },
          booking: { is: null },
          ...(ctx.projectId ? { OR: [{ projectId: ctx.projectId }, { projectId: null }] } : {}),
        },
        orderBy: { startsAt: "asc" },
        take: MAX_SLOTS,
        select: { id: true, startsAt: true, durationMin: true, kind: true },
      });
      if (slots.length === 0) return { slots: [], note: "No free times. Say a colleague will arrange a time, and hand off." };
      return { slots: slots.map((s) => ({ slot_id: s.id, when: formatDubai(s.startsAt), durationMin: s.durationMin, kind: s.kind })) };
    }

    case "book_viewing": {
      if (state.booking) return { error: "A viewing was already booked in this turn." };
      const taken = { error: "That time was just taken. Call list_slots and offer another." };
      let result: { error: string } | { booked: true; when: string; kind: string; slotId: string };
      try {
        // Checks and booking in one transaction: a slot is taken once a Booking points at it
        // (slotId is unique on Booking), so two leads can't book the same time.
        result = await prisma.$transaction(async (tx) => {
          const slot = await tx.availabilitySlot.findFirst({
            where: { id: call.args.slot_id, orgId: ctx.orgId },
            select: { id: true, startsAt: true, kind: true, projectId: true, booking: { select: { id: true } } },
          });
          if (!slot) return { error: "Unknown slot_id. Call list_slots and use one of its ids." };
          if (slot.startsAt <= ctx.now) return { error: "That time has passed. Call list_slots for current times." };
          if (slot.booking) return taken;
          if (ctx.projectId && slot.projectId && slot.projectId !== ctx.projectId) return { error: "That slot is for another project." };
          const existing = await tx.booking.findFirst({
            where: { orgId: ctx.orgId, leadId: ctx.leadId, status: "booked", startsAt: { gt: ctx.now } },
            select: { startsAt: true },
          });
          if (existing) {
            return { error: `The lead already has a viewing on ${formatDubai(existing.startsAt)}. To change it, hand off to a person.` };
          }
          await tx.booking.create({
            data: {
              orgId: ctx.orgId,
              leadId: ctx.leadId,
              projectId: slot.projectId ?? ctx.projectId,
              slotId: slot.id,
              startsAt: slot.startsAt,
              kind: slot.kind,
            },
          });
          return { booked: true as const, when: formatDubai(slot.startsAt), kind: slot.kind, slotId: slot.id };
        });
      } catch (err) {
        if ((err as { code?: string }).code === "P2002") return taken;
        throw err;
      }
      if ("error" in result) return result;
      state.booking = { slotId: result.slotId };
      return { booked: true, when: result.when, kind: result.kind };
    }

    case "send_document": {
      if (state.documents.length >= MAX_DOCUMENTS_PER_TURN) return { error: "Send at most three documents at a time." };
      const source = await prisma.knowledgeSource.findFirst({
        where: {
          id: call.args.source_id,
          orgId: ctx.orgId,
          kind: "file",
          status: "ready",
          AND: [
            { OR: [{ projectId: null }, ...(ctx.projectId ? [{ projectId: ctx.projectId }] : [])] },
            { OR: [{ validUntil: null }, { validUntil: { gte: ctx.now } }] },
          ],
        },
        select: { id: true, title: true, fileName: true },
      });
      if (!source) return { error: "Unknown document id. Use an id from the list of documents you can send." };
      if (state.documents.some((d) => d.document.sourceId === source.id)) return { sent: true, title: source.title, note: "Already sent." };
      state.documents.push({ kind: "document", body: source.title, document: { sourceId: source.id, title: source.title, fileName: source.fileName } });
      return { sent: true, title: source.title };
    }

    case "handoff_to_human": {
      state.handoff = true;
      state.handoffReason = call.args.reason;
      return { ok: true, note: "A colleague will follow up. Tell the lead briefly and politely; don't promise a time." };
    }
  }
}

// searchKnowledge doesn't report embedding usage yet; count it as soon as it does.
export function embeddingUsage(result: unknown): number {
  const usage = (result as { usage?: { total_tokens?: unknown; prompt_tokens?: unknown; tokens?: unknown } } | null)?.usage;
  const n = usage && (usage.total_tokens ?? usage.prompt_tokens ?? usage.tokens);
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
}
