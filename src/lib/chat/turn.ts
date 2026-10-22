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
  recentInboundAt: Date[]; // earlier inbound messages in the last minute (not this one)
  aiUnavailable: string | null; // why the AI connection can't be used, null when it's ready
  monthTokensUsed: number;
  flow: FlowDefinition;
  flowState: FlowState | null; // null when the conversation has no flow position yet
  flowCtx: FlowContext;
  now: Date;
};

export type TurnDeps = {
  freeChecks: (text: string, ctx: { settings: OrgSettings; recentInboundAt: Date[]; blocked: boolean; now?: Date }) => FreeCheckResult;
  advanceFlow: (def: FlowDefinition, state: FlowState, input: InboundInput, ctx: FlowContext) => FlowResult;
  scoreLead: (q: Qualification) => { score: Score; reasons: string[] };
  runAgent: (input: InboundInput, lang: Lang) => Promise<AgentTurnResult>;
};

export type OutgoingRecord = { author: "bot" | "ai" | "system"; message: OutgoingMessage };

export type LeadChanges = TurnLead & { score?: Score; scoreReasons?: string[] };

export type TurnOutcome = {
  messages: OutgoingRecord[];
  lead: LeadChanges;
  flowState: FlowState | null; // the new flow position, or null when unchanged
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

export function nextStatus(current: string, f: { handoff: boolean; finished: boolean; booked: boolean }): string {
  if (f.handoff) return "handed_off";
  if (current === "handed_off" || current === "closed") return current;
  if (f.booked || f.finished) return "qualified";
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
  const check = deps.freeChecks(f.text, { settings: f.settings, recentInboundAt: f.recentInboundAt, blocked: f.lead.blocked, now: f.now });
  if (!check.ok) {
    if (check.strike) {
      lead.strikes += 1;
      if (lead.strikes >= f.settings.strikeLimit) lead.aiStopped = true;
    }
    const messages: OutgoingRecord[] = check.reply ? [{ author: "bot", message: { kind: "text", body: localize(check.reply, f.lead.language) } }] : [];
    return finish({ messages, flowState: null, needsHuman: false, booking: null, trace: emptyTrace("none", FREE_CHECK_WHY[check.reason], check) });
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

    if (result.error || result.messages.length === 0) {
      const why = result.error ? "AI error, scripted fallback" : "AI gave no reply, scripted fallback";
      return finish(scriptedTurn(f, deps, lead, { ...aiTrace, mode: "scripted", why }));
    }

    lead.qualification = mergeQualification(lead.qualification, result.patch);
    rescore(lead, deps);
    lead.status = nextStatus(lead.status, { handoff: result.handoff, finished: false, booked: Boolean(result.booking) });
    const messages: OutgoingRecord[] = result.messages.map((message) => ({ author: message.kind === "note" ? "system" : "ai", message }));
    if (result.handoff) addHandoffNote(messages);
    return finish({ messages, flowState: null, needsHuman: result.handoff, booking: result.booking, trace: aiTrace });
  }

  return finish(scriptedTurn(f, deps, lead, emptyTrace("scripted", choice.why, check)));
}

function scriptedTurn(f: TurnFacts, deps: TurnDeps, lead: LeadChanges, trace: TurnTrace): Omit<TurnOutcome, "lead"> {
  const state: FlowState = f.flowState ?? { stepId: f.flow.start || null, lang: f.lead.language, retries: 0 };
  const flowCtx = { ...f.flowCtx, qualification: lead.qualification };
  const result = deps.advanceFlow(f.flow, state, f.input, flowCtx);
  lead.qualification = mergeQualification(lead.qualification, result.patch);
  lead.language = result.state.lang;
  rescore(lead, deps);
  lead.status = nextStatus(lead.status, { handoff: result.handoff, finished: result.state.stepId === null, booked: Boolean(result.booking) });
  const messages: OutgoingRecord[] = result.messages.map((message) => ({ author: message.kind === "note" ? "system" : "bot", message }));
  if (result.handoff) addHandoffNote(messages);
  return { messages, flowState: result.state, needsHuman: result.handoff, booking: result.booking ?? null, trace };
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
