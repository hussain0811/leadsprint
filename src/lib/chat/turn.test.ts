import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyScope,
  asUnsentNotes,
  chooseResponder,
  counterUpdate,
  dubaiMonthStart,
  HANDOFF_NOTE,
  mergeQualification,
  nextStatus,
  replyForFailedBooking,
  runTurn,
  type TurnDeps,
  type TurnFacts,
} from "./turn";
import { DEFAULT_SETTINGS, type AgentTurnResult, type FlowDefinition, type FlowResult, type FreeCheckResult } from "./types";

const FLOW: FlowDefinition = {
  greeting: { en: "Hi, I'm an automated assistant", ar: "مرحبا" },
  start: "intent",
  steps: [],
  done: { en: "Thanks", ar: "شكرا" },
  handoff: { en: "A person will reply", ar: "سيرد عليك شخص" },
};

function facts(over: Partial<TurnFacts> = {}, lead: Partial<TurnFacts["lead"]> = {}): TurnFacts {
  return {
    input: { text: "I want to buy" },
    text: "I want to buy",
    settings: DEFAULT_SETTINGS,
    forceScripted: false,
    lead: { language: "en", qualification: {}, status: "qualifying", strikes: 0, offTopicStreak: 0, aiStopped: false, tokensUsed: 0, blocked: false, ...lead },
    recentInboundAt: [],
    aiUnavailable: null,
    monthTokensUsed: 0,
    flow: FLOW,
    flowState: { stepId: "intent", lang: "en", retries: 0 },
    flowCtx: { qualification: {}, orgName: "Demo Realty", projectName: null, slots: [] },
    now: new Date("2026-10-22T10:00:00Z"),
    ...over,
  };
}

function agentResult(over: Partial<AgentTurnResult> = {}): AgentTurnResult {
  return {
    messages: [{ kind: "text", body: "Great, what's your budget?" }],
    patch: { intent: "buy" },
    booking: null,
    handoff: false,
    scope: "on_topic",
    toolCalls: [],
    passages: [],
    replyCheck: { ok: true },
    tokens: { input: 100, output: 20 },
    error: null,
    ...over,
  };
}

// Fakes that record what was called.
function fakes(opts: { check?: FreeCheckResult; agent?: AgentTurnResult | Error; flow?: Partial<FlowResult> } = {}) {
  const calls = { agent: 0, flow: 0, score: 0, recent: [] as Date[][], taps: [] as Array<boolean | undefined>, flowFrom: [] as Array<string | null>, flowQual: [] as unknown[] };
  const deps: TurnDeps = {
    freeChecks: (_text, ctx) => {
      calls.taps.push(ctx.tap);
      calls.recent.push(ctx.recentInboundAt);
      return opts.check ?? { ok: true };
    },
    advanceFlow: (_def, state, _input, ctx) => {
      calls.flow++;
      calls.flowFrom.push(state.stepId);
      calls.flowQual.push(ctx.qualification);
      return {
        state: { ...state, stepId: "budget" },
        messages: [{ kind: "buttons", body: "Your budget?", buttons: [{ id: "b1", title: "Under 1M" }] }],
        patch: { intent: "buy" },
        handoff: false,
        ...opts.flow,
      };
    },
    scoreLead: (q) => {
      calls.score++;
      return { score: q.intent === "buy" ? "warm" : "unknown", reasons: q.intent ? ["Wants to buy"] : [] };
    },
    runAgent: async () => {
      calls.agent++;
      if (opts.agent instanceof Error) throw opts.agent;
      return opts.agent ?? agentResult();
    },
  };
  return { deps, calls };
}

test("chooseResponder explains why the AI isn't used", () => {
  const base = { forceScripted: false, aiUnavailable: null, aiStopped: false, tokensUsed: 0, monthTokensUsed: 0, settings: DEFAULT_SETTINGS };
  assert.equal(chooseResponder(base).mode, "ai");
  assert.deepEqual(chooseResponder({ ...base, forceScripted: true }), { mode: "scripted", why: "Scripted mode is on for this conversation" });
  assert.deepEqual(chooseResponder({ ...base, aiUnavailable: "No AI connection" }), { mode: "scripted", why: "No AI connection" });
  assert.equal(chooseResponder({ ...base, aiStopped: true }).why, "Strike limit reached, AI stopped for this lead");
  assert.equal(chooseResponder({ ...base, tokensUsed: DEFAULT_SETTINGS.leadTokenBudget }).why, "Lead token budget used up");
  assert.equal(chooseResponder({ ...base, monthTokensUsed: DEFAULT_SETTINGS.monthlyTokenBudget }).why, "Monthly token budget used up");
});

test("applyScope: abuse is a strike, a run of off-topic messages is one strike, on-topic resets the run", () => {
  const s = { ...DEFAULT_SETTINGS, offTopicStreakForStrike: 3, strikeLimit: 2 };
  const zero = { strikes: 0, offTopicStreak: 0, aiStopped: false };
  assert.deepEqual(applyScope(zero, "abuse", s), { strikes: 1, offTopicStreak: 0, aiStopped: false });
  assert.deepEqual(applyScope({ ...zero, offTopicStreak: 1 }, "off_topic", s), { strikes: 0, offTopicStreak: 2, aiStopped: false });
  assert.deepEqual(applyScope({ ...zero, offTopicStreak: 2 }, "off_topic", s), { strikes: 1, offTopicStreak: 0, aiStopped: false });
  assert.deepEqual(applyScope({ ...zero, offTopicStreak: 2 }, "on_topic", s), zero);
  assert.deepEqual(applyScope({ ...zero, offTopicStreak: 2 }, "small_talk", s), zero);
  assert.deepEqual(applyScope({ strikes: 1, offTopicStreak: 0, aiStopped: false }, "abuse", s), { strikes: 2, offTopicStreak: 0, aiStopped: true });
  assert.deepEqual(applyScope({ ...zero, offTopicStreak: 2 }, null, s), { ...zero, offTopicStreak: 2 });
});

test("mergeQualification ignores undefined values; nextStatus keeps handed-off leads handed off", () => {
  assert.deepEqual(mergeQualification({ intent: "buy", bedrooms: 2 }, { bedrooms: undefined, area: "Marina" }), { intent: "buy", bedrooms: 2, area: "Marina" });
  assert.equal(nextStatus("new", { handoff: false, finished: false, booked: false }), "qualifying");
  assert.equal(nextStatus("qualifying", { handoff: false, finished: true, booked: false }), "qualified");
  assert.equal(nextStatus("qualifying", { handoff: true, finished: false, booked: false }), "handed_off");
  assert.equal(nextStatus("handed_off", { handoff: false, finished: true, booked: true }), "handed_off");
});

test("a failed free check sends its reply, adds a strike, and runs neither the AI nor the flow", async () => {
  const { deps, calls } = fakes({ check: { ok: false, reason: "abuse_pattern", strike: true, reply: { en: "Let's keep it about property.", ar: "لنتحدث عن العقارات" } } });
  const out = await runTurn(facts({}, { language: "ar", strikes: 2 }), deps);
  assert.equal(calls.agent + calls.flow + calls.score, 0);
  assert.deepEqual(out.messages, [{ author: "bot", message: { kind: "text", body: "لنتحدث عن العقارات" } }]);
  assert.equal(out.lead.strikes, 3);
  assert.equal(out.lead.aiStopped, true); // strike limit is 3
  assert.equal(out.trace.mode, "none");
  assert.equal(out.flowState, null);
});

test("a failed free check without a reply or strike sends nothing", async () => {
  const { deps } = fakes({ check: { ok: false, reason: "rate_limited", strike: false, reply: null } });
  const recent = [new Date("2026-10-22T09:59:30Z")];
  const out = await runTurn(facts({ recentInboundAt: recent }), deps);
  assert.deepEqual(out.messages, []);
  assert.equal(out.lead.strikes, 0);
  assert.equal(out.trace.why, "Too many messages in a minute");
});

test("with a ready AI connection the agent answers, and its patch is scored and its tokens counted", async () => {
  const { deps, calls } = fakes();
  const out = await runTurn(facts({}, { tokensUsed: 500 }), deps);
  assert.equal(calls.agent, 1);
  assert.equal(calls.flow, 0);
  assert.equal(out.trace.mode, "ai");
  assert.deepEqual(out.messages, [{ author: "ai", message: { kind: "text", body: "Great, what's your budget?" } }]);
  assert.deepEqual(out.lead.qualification, { intent: "buy" });
  assert.equal(out.lead.score, "warm");
  assert.deepEqual(out.lead.scoreReasons, ["Wants to buy"]);
  assert.equal(out.lead.tokensUsed, 620);
  assert.equal(out.flowState, null); // the AI doesn't move the flow
  assert.deepEqual(out.trace.tokens, { input: 100, output: 20 });
});

test("without an AI connection the scripted flow answers and moves on", async () => {
  const { deps, calls } = fakes();
  const out = await runTurn(facts({ aiUnavailable: "No AI connection" }), deps);
  assert.equal(calls.agent, 0);
  assert.equal(out.trace.mode, "scripted");
  assert.equal(out.trace.why, "No AI connection");
  assert.equal(out.messages[0].author, "bot");
  assert.deepEqual(out.flowState, { stepId: "budget", lang: "en", retries: 0 });
  assert.equal(out.lead.score, "warm");
});

test("forced scripted mode, a stopped lead and spent budgets all skip the AI", async () => {
  const cases: Array<[Partial<TurnFacts>, Partial<TurnFacts["lead"]>]> = [
    [{ forceScripted: true }, {}],
    [{}, { aiStopped: true }],
    [{}, { tokensUsed: DEFAULT_SETTINGS.leadTokenBudget }],
    [{ monthTokensUsed: DEFAULT_SETTINGS.monthlyTokenBudget + 1 }, {}],
  ];
  for (const [over, lead] of cases) {
    const { deps, calls } = fakes();
    const out = await runTurn(facts(over, lead), deps);
    assert.equal(calls.agent, 0, JSON.stringify([over, lead]));
    assert.equal(out.trace.mode, "scripted");
  }
});

test("an agent error falls back to the flow for this message, keeping the error and tokens in the trace", async () => {
  const { deps, calls } = fakes({ agent: agentResult({ messages: [], error: "Server timed out", tokens: { input: 50, output: 0 } }) });
  const out = await runTurn(facts(), deps);
  assert.equal(calls.flow, 1);
  assert.equal(out.trace.mode, "scripted");
  assert.equal(out.trace.why, "AI error, scripted fallback");
  assert.equal(out.trace.error, "Server timed out");
  assert.equal(out.lead.tokensUsed, 50);
  assert.equal(out.messages[0].author, "bot");
  assert.ok(out.flowState);
});

test("an agent with no messages, or one that throws, also falls back", async () => {
  const empty = fakes({ agent: agentResult({ messages: [] }) });
  assert.equal((await runTurn(facts(), empty.deps)).trace.why, "AI gave no reply, scripted fallback");
  const thrown = fakes({ agent: new Error("boom") });
  const out = await runTurn(facts(), thrown.deps);
  assert.equal(out.trace.error, "boom");
  assert.equal(thrown.calls.flow, 1);
});

test("off-topic and abuse labels from the agent update strikes, and the strike limit stops the AI", async () => {
  const settings = { ...DEFAULT_SETTINGS, offTopicStreakForStrike: 2, strikeLimit: 2 };
  const offTopic = fakes({ agent: agentResult({ scope: "off_topic", patch: {} }) });
  let out = await runTurn(facts({ settings }, { offTopicStreak: 1, strikes: 1 }), offTopic.deps);
  assert.deepEqual([out.lead.strikes, out.lead.offTopicStreak, out.lead.aiStopped], [2, 0, true]);
  assert.equal(out.messages[0].author, "ai"); // this turn's reply still goes out

  const abuse = fakes({ agent: agentResult({ scope: "abuse", patch: {} }) });
  out = await runTurn(facts({ settings }), abuse.deps);
  assert.deepEqual([out.lead.strikes, out.lead.aiStopped], [1, false]);
});

test("a handoff flags the conversation, sets the status and adds a note for the admin", async () => {
  const ai = fakes({ agent: agentResult({ handoff: true }) });
  let out = await runTurn(facts(), ai.deps);
  assert.equal(out.needsHuman, true);
  assert.equal(out.lead.status, "handed_off");
  assert.deepEqual(out.messages.at(-1), { author: "system", message: { kind: "note", body: HANDOFF_NOTE } });

  const flow = fakes({ flow: { handoff: true } });
  out = await runTurn(facts({ forceScripted: true }), flow.deps);
  assert.equal(out.needsHuman, true);
  assert.equal(out.lead.status, "handed_off");
});

test("the flow's booking and language come through, and a finished flow qualifies the lead", async () => {
  const { deps } = fakes({ flow: { state: { stepId: null, lang: "ar", retries: 0 }, booking: { slotId: "slot1" } } });
  const out = await runTurn(facts({ forceScripted: true }), deps);
  assert.deepEqual(out.booking, { slotId: "slot1" });
  assert.equal(out.lead.language, "ar");
  assert.equal(out.lead.status, "qualified");
});

test("a conversation with no flow position starts at the flow's first step", async () => {
  let seen: string | null = "";
  const { deps } = fakes();
  deps.advanceFlow = (_def, state) => {
    seen = state.stepId;
    return { state, messages: [], patch: {}, handoff: false };
  };
  await runTurn(facts({ forceScripted: true, flowState: null }), deps);
  assert.equal(seen, "intent");
});

test("an agent handoff with no reply says the flow's handoff line, flags the conversation and skips the flow", async () => {
  const { deps, calls } = fakes({ agent: agentResult({ messages: [], handoff: true, patch: { payment: "cash" } }) });
  const out = await runTurn(facts(), deps);
  assert.equal(calls.flow, 0);
  assert.deepEqual(out.messages, [
    { author: "bot", message: { kind: "text", body: "A person will reply" } },
    { author: "system", message: { kind: "note", body: HANDOFF_NOTE } },
  ]);
  assert.equal(out.needsHuman, true);
  assert.equal(out.lead.status, "handed_off");
  assert.equal(out.statusFlags?.handoff, true);
  assert.deepEqual(out.lead.qualification, { payment: "cash" });
  assert.equal(out.trace.mode, "ai");
});

test("a fallback keeps the agent's patch and booking, and resumes the flow from no fixed step", async () => {
  const { deps, calls } = fakes({ agent: agentResult({ messages: [], error: "timeout", patch: { area: "Marina" }, booking: { slotId: "s9" } }) });
  const out = await runTurn(facts(), deps);
  assert.deepEqual(calls.flowFrom, [null]);
  assert.deepEqual(calls.flowQual[0], { area: "Marina" }); // the flow sees what the AI collected
  assert.deepEqual(out.lead.qualification, { area: "Marina", intent: "buy" });
  assert.deepEqual(out.booking, { slotId: "s9" });
  assert.equal(out.statusFlags?.booked, true);
  assert.equal(out.lead.status, "qualified");
});

test("plain scripted turns answer from the saved flow position", async () => {
  const { deps, calls } = fakes();
  const out = await runTurn(facts({ forceScripted: true }), deps);
  assert.deepEqual(calls.flowFrom, ["intent"]);
  assert.equal(out.flowStateBefore?.stepId, "intent");
});

test("a lead who finishes the flow only browsing isn't qualified", async () => {
  assert.equal(nextStatus("qualifying", { handoff: false, finished: true, booked: false, browsing: true }), "qualifying");
  const { deps } = fakes({ flow: { state: { stepId: null, lang: "en", retries: 0 }, patch: { intent: "browsing" } } });
  const out = await runTurn(facts({ forceScripted: true }), deps);
  assert.equal(out.lead.status, "qualifying");
  assert.equal(out.statusFlags?.browsing, true);
});

test("taps are flagged to the free checks so they skip the rate limit", async () => {
  const { deps, calls } = fakes();
  await runTurn(facts({ input: { replyId: "b1" }, text: "Under 1M" }), deps);
  await runTurn(facts(), deps);
  assert.deepEqual(calls.taps, [true, false]);
});

test("a free-check failure leaves the status alone", async () => {
  const { deps } = fakes({ check: { ok: false, reason: "too_long", strike: false, reply: null } });
  assert.equal((await runTurn(facts(), deps)).statusFlags, null);
});

test("asUnsentNotes turns a reply into admin notes", () => {
  const notes = asUnsentNotes(
    [
      { author: "ai", message: { kind: "text", body: "Hello" } },
      { author: "system", message: { kind: "note", body: HANDOFF_NOTE } },
    ],
    "a person took over",
  );
  assert.deepEqual(notes, [{ author: "system", message: { kind: "note", body: "Not sent (a person took over): Hello" } }]);
});

test("replyForFailedBooking offers the free slots again, or names the existing booking", () => {
  const reply = [
    { author: "bot" as const, message: { kind: "text" as const, body: "Booked for Mon 11am" } },
    { author: "bot" as const, message: { kind: "text" as const, body: "Thanks" } },
  ];
  const taken = replyForFailedBooking(reply, { ok: false, reason: "taken" }, "en", [{ id: "s2", title: "Tue 4pm", description: "viewing" }]);
  assert.equal(taken.length, 1);
  const msg = taken[0].message;
  assert.equal(msg.kind, "list");
  assert.ok(msg.kind === "list" && msg.body.includes("just taken") && msg.rows[0].id === "slot:s2");

  const none = replyForFailedBooking(reply, { ok: false, reason: "taken" }, "en", []);
  assert.equal(none[0].message.kind, "text");

  const already = replyForFailedBooking(reply, { ok: false, reason: "already_booked", existingAt: "Sun 1 Nov, 11:00 am" }, "en", []);
  assert.equal(already.length, 2);
  assert.ok(already[0].message.body.includes("Sun 1 Nov, 11:00 am"));
  assert.equal(already[1].message.body, "Thanks");
});

test("counterUpdate writes increments, a reset streak as 0, and only ever turns aiStopped on", () => {
  const before = { language: "en" as const, qualification: {}, status: "new", strikes: 1, offTopicStreak: 3, aiStopped: false, tokensUsed: 100, blocked: false };
  assert.deepEqual(counterUpdate(before, { ...before, strikes: 2, offTopicStreak: 0, tokensUsed: 250, aiStopped: true }), {
    strikes: { increment: 1 },
    tokensUsed: { increment: 150 },
    offTopicStreak: 0,
    aiStopped: true,
  });
  assert.deepEqual(counterUpdate(before, { ...before, offTopicStreak: 4 }), {
    strikes: { increment: 0 },
    tokensUsed: { increment: 0 },
    offTopicStreak: { increment: 1 },
  });
});

test("dubaiMonthStart uses Dubai's calendar month", () => {
  // 21:00 UTC on 31 Oct is already 1 Nov in Dubai.
  assert.equal(dubaiMonthStart(new Date("2026-10-31T21:00:00Z")).toISOString(), "2026-10-31T20:00:00.000Z");
  assert.equal(dubaiMonthStart(new Date("2026-10-15T12:00:00Z")).toISOString(), "2026-09-30T20:00:00.000Z");
});
