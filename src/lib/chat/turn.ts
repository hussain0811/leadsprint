import type { FlowContext } from "./flow";
import type {
  AgentTurnResult,
  FlowDefinition,
  FlowResult,
  FlowState,
  FreeCheckResult,
  InboundInput,
  Lang,
  Localized,
  OrgSettings,
  OutgoingMessage,
  Qualification,
  Score,
  ScopeLabel,
  TurnTrace,
} from "./types";

// The decisions for one lead message, kept free of the database so they can be tested with fakes.
// pipeline.ts loads the facts, calls runTurn, and saves what it returns.

export type TurnLead = {
  language: Lang;
  qualification: Qualification;
  status: string;
  strikes: number;
  offTopicStreak: number;
  aiStopped: boolean;
  tokensUsed: number;
  blocked: boolean;
};

export type TurnFacts = {
  input: InboundInput;
  text: string; // typed text, or the title of the tapped option
  settings: OrgSettings;
  forceScripted: boolean;
  lead: TurnLead;
  recentInboundAt: Date[]; // earlier typed (not tapped) inbound messages in the last minute, not this one
  aiUnavailable: string | null; // why the AI connection can't be used, null when it's ready
  monthTokensUsed: number;
  flow: FlowDefinition;
  flowState: FlowState | null; // null when the conversation has no flow position yet
  flowCtx: FlowContext;
  now: Date;
};

export type TurnDeps = {
  freeChecks: (text: string, ctx: { settings: OrgSettings; recentInboundAt: Date[]; blocked: boolean; now?: Date; tap?: boolean }) => FreeCheckResult;
  advanceFlow: (def: FlowDefinition, state: FlowState, input: InboundInput, ctx: FlowContext) => FlowResult;
  scoreLead: (q: Qualification) => { score: Score; reasons: string[] };
  runAgent: (input: InboundInput, lang: Lang) => Promise<AgentTurnResult>;
};

export type OutgoingRecord = { author: "bot" | "ai" | "system"; message: OutgoingMessage };

export type LeadChanges = TurnLead & { score?: Score; scoreReasons?: string[] };

export type StatusFlags = { handoff: boolean; finished: boolean; booked: boolean; browsing: boolean };

export type TurnOutcome = {
  messages: OutgoingRecord[];
  lead: LeadChanges;
  // What decides the lead's status; null = leave it. The pipeline applies it to the status as it is
  // when the turn is saved (lead.status here is the same rule applied to the status read at the start).
  statusFlags: StatusFlags | null;
  flowState: FlowState | null; // the new flow position, or null when unchanged
  flowStateBefore: FlowState | null; // the position the flow answered from (to ask a taken slot again)
  needsHuman: boolean; // true = flag the conversation for a person (never clears it)
  booking: { slotId: string } | null;
  trace: TurnTrace;
};

export const HANDOFF_NOTE = "Handed to a person";
export const FLOW_NAME = "Default"; // the Flow row the Flows page edits

const FREE_CHECK_WHY: Record<Exclude<FreeCheckResult, { ok: true }>["reason"], string> = {
  too_long: "Message too long, asked the lead to keep it short",
  rate_limited: "Too many messages in a minute",
  abuse_pattern: "Message looked like misuse",
  blocked: "Lead is blocked",
};

export function emptyTrace(mode: TurnTrace["mode"], why: string, freeCheck: FreeCheckResult = { ok: true }): TurnTrace {
  return { mode, why, freeCheck, scope: null, toolCalls: [], passages: [], replyCheck: null, tokens: null, ms: 0, error: null };
}

/** Who answers this message, and why. Human takeover is handled before this is asked. */
export function chooseResponder(f: {
  forceScripted: boolean;
  aiUnavailable: string | null;
  aiStopped: boolean;
  tokensUsed: number;
  monthTokensUsed: number;
  settings: OrgSettings;
}): { mode: "ai" | "scripted"; why: string } {
  if (f.forceScripted) return { mode: "scripted", why: "Scripted mode is on for this conversation" };
  if (f.aiUnavailable) return { mode: "scripted", why: f.aiUnavailable };
  if (f.aiStopped) return { mode: "scripted", why: "Strike limit reached, AI stopped for this lead" };
  if (f.tokensUsed >= f.settings.leadTokenBudget) return { mode: "scripted", why: "Lead token budget used up" };
  if (f.monthTokensUsed >= f.settings.monthlyTokenBudget) return { mode: "scripted", why: "Monthly token budget used up" };
  return { mode: "ai", why: "AI connection ready" };
}

/** Updates the strike counters for one message's topic label. */
export function applyScope(
  counters: { strikes: number; offTopicStreak: number; aiStopped: boolean },
  scope: ScopeLabel | null,
  settings: OrgSettings,
): { strikes: number; offTopicStreak: number; aiStopped: boolean } {
  let { strikes, offTopicStreak } = counters;
  if (scope === "abuse") {
    strikes += 1;
  } else if (scope === "off_topic") {
    offTopicStreak += 1;
    if (offTopicStreak >= settings.offTopicStreakForStrike) {
      strikes += 1;
      offTopicStreak = 0;
    }
  } else if (scope === "on_topic" || scope === "small_talk") {
    offTopicStreak = 0;
  }
  return { strikes, offTopicStreak, aiStopped: counters.aiStopped || strikes >= settings.strikeLimit };
}

export function mergeQualification(q: Qualification, patch: Partial<Qualification>): Qualification {
  const next: Qualification = { ...q };
  for (const [key, value] of Object.entries(patch) as Array<[keyof Qualification, unknown]>) {
    if (value !== undefined) (next as Record<string, unknown>)[key] = value;
  }
  return next;
}

// A lead who finished the flow only browsing stays "qualifying"; the score marks them cold.
export function nextStatus(current: string, f: { handoff: boolean; finished: boolean; booked: boolean; browsing?: boolean }): string {
  if (f.handoff) return "handed_off";
  if (current === "handed_off" || current === "closed") return current;
  if (f.booked || (f.finished && !f.browsing)) return "qualified";
  return "qualifying";
}

export function localize(text: Localized, lang: Lang): string {
  return text[lang] || text.en;
}

/** One lead message, after it was saved and when no person has taken over. */
export async function runTurn(f: TurnFacts, deps: TurnDeps): Promise<TurnOutcome> {
  const started = Date.now();
  const lead: LeadChanges = { ...f.lead };
  const finish = (o: Omit<TurnOutcome, "lead">): TurnOutcome => ({ ...o, lead, trace: { ...o.trace, ms: Date.now() - started } });

  // 1. Free checks: no AI and no flow step when they fail.
  const check = deps.freeChecks(f.text, { settings: f.settings, recentInboundAt: f.recentInboundAt, blocked: f.lead.blocked, now: f.now, tap: Boolean(f.input.replyId) });
  if (!check.ok) {
    if (check.strike) {
      lead.strikes += 1;
      if (lead.strikes >= f.settings.strikeLimit) lead.aiStopped = true;
    }
    const messages: OutgoingRecord[] = check.reply ? [{ author: "bot", message: { kind: "text", body: localize(check.reply, f.lead.language) } }] : [];
    return finish({
      messages,
      statusFlags: null,
      flowState: null,
      flowStateBefore: null,
      needsHuman: false,
      booking: null,
      trace: emptyTrace("none", FREE_CHECK_WHY[check.reason], check),
    });
  }

  // 2. Who answers.
  const choice = chooseResponder({ ...f, aiStopped: f.lead.aiStopped, tokensUsed: f.lead.tokensUsed });

  if (choice.mode === "ai") {
    let result: AgentTurnResult;
    try {
      result = await deps.runAgent(f.input, f.lead.language);
    } catch (err) {
      // The agent promises not to throw; if it does anyway, treat it like any other agent error.
      result = {
        messages: [], patch: {}, booking: null, handoff: false, scope: null, toolCalls: [], passages: [], replyCheck: null,
        tokens: { input: 0, output: 0 }, error: err instanceof Error ? err.message : String(err),
      };
    }
    lead.tokensUsed += result.tokens.input + result.tokens.output;
    Object.assign(lead, applyScope(lead, result.scope, f.settings));
    const aiTrace: TurnTrace = {
      mode: "ai",
      why: choice.why,
      freeCheck: check,
      scope: result.scope,
      toolCalls: result.toolCalls,
      passages: result.passages,
      replyCheck: result.replyCheck,
      tokens: result.tokens,
      ms: 0,
      error: result.error,
    };

    // What the agent collected or booked counts even when its reply doesn't.
    lead.qualification = mergeQualification(lead.qualification, result.patch);

    if (result.messages.length === 0 && result.handoff) {
      // Handed over without a reply: say the flow's handoff line rather than asking the next question.
      const body = fillText(localize(f.flow.handoff, lead.language), f);
      const messages: OutgoingRecord[] = [{ author: "bot", message: { kind: "text", body } }];
      addHandoffNote(messages);
      return finish(aiOutcome(lead, deps, messages, true, result.booking, { ...aiTrace, why: "AI handed the lead to a person" }));
    }

    if (result.error || result.messages.length === 0) {
      const why = result.error ? "AI error, scripted fallback" : "AI gave no reply, scripted fallback";
      // The AI was leading, so the flow's saved position is stale: let it pick the next unanswered question.
      const from: FlowState = { stepId: null, lang: f.flowState?.lang ?? lead.language, retries: 0 };
      const out = scriptedTurn(f, deps, lead, { ...aiTrace, mode: "scripted", why }, from);
      if (result.booking && !out.booking) {
        out.booking = result.booking;
        out.statusFlags = { ...(out.statusFlags ?? { handoff: false, finished: false, browsing: false }), booked: true };
        lead.status = nextStatus(f.lead.status, out.statusFlags);
      }
      return finish(out);
    }

    const messages: OutgoingRecord[] = result.messages.map((message) => ({ author: message.kind === "note" ? "system" : "ai", message }));
    if (result.handoff) addHandoffNote(messages);
    return finish(aiOutcome(lead, deps, messages, result.handoff, result.booking, aiTrace));
  }

  return finish(scriptedTurn(f, deps, lead, emptyTrace("scripted", choice.why, check)));
}

function aiOutcome(
  lead: LeadChanges,
  deps: TurnDeps,
  messages: OutgoingRecord[],
  handoff: boolean,
  booking: { slotId: string } | null,
  trace: TurnTrace,
): Omit<TurnOutcome, "lead"> {
  rescore(lead, deps);
  const statusFlags: StatusFlags = { handoff, finished: false, booked: Boolean(booking), browsing: lead.qualification.intent === "browsing" };
  lead.status = nextStatus(lead.status, statusFlags);
  return { messages, statusFlags, flowState: null, flowStateBefore: null, needsHuman: handoff, booking, trace };
}

function scriptedTurn(f: TurnFacts, deps: TurnDeps, lead: LeadChanges, trace: TurnTrace, from?: FlowState): Omit<TurnOutcome, "lead"> {
  const state: FlowState = from ?? f.flowState ?? { stepId: f.flow.start || null, lang: f.lead.language, retries: 0 };
  const flowCtx = { ...f.flowCtx, qualification: lead.qualification };
  const result = deps.advanceFlow(f.flow, state, f.input, flowCtx);
  lead.qualification = mergeQualification(lead.qualification, result.patch);
  lead.language = result.state.lang;
  rescore(lead, deps);
  const statusFlags: StatusFlags = {
    handoff: result.handoff,
    finished: result.state.stepId === null,
    booked: Boolean(result.booking),
    browsing: lead.qualification.intent === "browsing",
  };
  lead.status = nextStatus(lead.status, statusFlags);
  const messages: OutgoingRecord[] = result.messages.map((message) => ({ author: message.kind === "note" ? "system" : "bot", message }));
  if (result.handoff) addHandoffNote(messages);
  return {
    messages,
    statusFlags,
    flowState: result.state,
    flowStateBefore: state,
    needsHuman: result.handoff,
    booking: result.booking ?? null,
    trace,
  };
}

function fillText(text: string, f: TurnFacts): string {
  return text.replaceAll("{org}", f.flowCtx.orgName).replaceAll("{project}", f.flowCtx.projectName ?? "");
}

function rescore(lead: LeadChanges, deps: TurnDeps) {
  const { score, reasons } = deps.scoreLead(lead.qualification);
  lead.score = score;
  lead.scoreReasons = reasons;
}

// Tells the admin the lead was passed on, unless the reply already carries a note.
function addHandoffNote(messages: OutgoingRecord[]) {
  if (!messages.some((m) => m.message.kind === "note")) messages.push({ author: "system", message: { kind: "note", body: HANDOFF_NOTE } });
}

/* ---------- Helpers the pipeline uses when saving a turn ---------- */

/** A reply that can no longer be sent (a person took over, or the lead was blocked) is kept as admin notes. */
export function asUnsentNotes(messages: OutgoingRecord[], reason: string): OutgoingRecord[] {
  return messages
    .filter((m) => m.message.kind !== "note")
    .map((m) => ({ author: "system" as const, message: { kind: "note" as const, body: `Not sent (${reason}): ${m.message.body}` } }));
}

export type BookResult = { ok: true } | { ok: false; reason: "taken" | "already_booked"; existingAt?: string };

const TAKEN: Localized = {
  en: "Sorry, that time was just taken. Please pick another time.",
  ar: "عذرًا، هذا الموعد حُجز للتو. اختر موعدًا آخر من فضلك.",
};
const NO_OTHER: Localized = {
  en: "Sorry, that time was just taken and there are no other free times right now. Our team will arrange one with you.",
  ar: "عذرًا، هذا الموعد حُجز للتو ولا توجد مواعيد أخرى متاحة الآن. سيتواصل معك فريقنا لترتيب موعد.",
};
const ALREADY: Localized = {
  en: "You already have a booking on {time}. Reply here if you'd like to change it.",
  ar: "لديك حجز بالفعل في {time}. راسلنا هنا إذا أردت تغييره.",
};
const PICK_TIME: Localized = { en: "Pick a time", ar: "اختر موعدًا" };

/**
 * Rewrites a turn's reply when its booking didn't go through. "taken": the confirmation is replaced
 * by "just taken" and the free slots again (row ids match the flow's booking step). "already_booked":
 * the confirmation is replaced by the existing booking's time and the rest of the reply is kept.
 */
export function replyForFailedBooking(
  messages: OutgoingRecord[],
  failed: Extract<BookResult, { ok: false }>,
  lang: Lang,
  slots: Array<{ id: string; title: string; description?: string }>,
): OutgoingRecord[] {
  const author = messages.find((m) => m.author !== "system")?.author ?? "bot";
  if (failed.reason === "already_booked") {
    const body = localize(ALREADY, lang).replace("{time}", failed.existingAt ?? "");
    return [{ author, message: { kind: "text", body } }, ...messages.filter((m) => m.author !== "system").slice(1)];
  }
  if (slots.length === 0) return [{ author, message: { kind: "text", body: localize(NO_OTHER, lang) } }];
  const rows = slots.slice(0, 10).map((s) => ({ id: `slot:${s.id}`, title: s.title.slice(0, 24), ...(s.description ? { description: s.description } : {}) }));
  return [{ author, message: { kind: "list", body: localize(TAKEN, lang), buttonLabel: localize(PICK_TIME, lang), rows } }];
}

/** Counter changes as increments, so a turn that overlapped another (or an admin edit) doesn't undo its counts. */
export function counterUpdate(before: TurnLead, after: TurnLead) {
  return {
    strikes: { increment: after.strikes - before.strikes },
    tokensUsed: { increment: after.tokensUsed - before.tokensUsed },
    offTopicStreak: after.offTopicStreak === 0 && before.offTopicStreak !== 0 ? 0 : { increment: after.offTopicStreak - before.offTopicStreak },
    ...(after.aiStopped && !before.aiStopped ? { aiStopped: true } : {}),
  };
}

/** The first moment of the current calendar month in Dubai time (UTC+4, no daylight saving). */
export function dubaiMonthStart(now: Date): Date {
  const offset = 4 * 3600_000;
  const local = new Date(now.getTime() + offset);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - offset);
}
