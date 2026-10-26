import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_FLOW, advanceFlow, formatSlot, startFlow, validateFlow, type FlowContext } from "./flow";
import { WA_LIMITS, type FlowDefinition, type FlowResult, type FlowState, type InboundInput, type Lang, type Qualification } from "./types";

const slots = Array.from({ length: 12 }, (_, i) => ({
  id: `s${i + 1}`,
  // 11:00 and 16:00 Dubai time (07:00 and 12:00 UTC) from 23 Oct 2026.
  startsAt: new Date(Date.UTC(2026, 9, 23 + Math.floor(i / 2), i % 2 === 0 ? 7 : 12)).toISOString(),
  kind: "viewing",
}));

function ctxWith(q: Qualification = {}, extra: Partial<FlowContext> = {}): FlowContext {
  return { qualification: q, orgName: "Demo Realty", projectName: "Marina Crest", slots, ...extra };
}

/** Plays a conversation, carrying state and qualification between turns. */
function play(inputs: InboundInput[], lang: Lang = "en", extra: Partial<FlowContext> = {}) {
  let q: Qualification = {};
  const start = startFlow(DEFAULT_FLOW, lang, ctxWith(q, extra));
  let state: FlowState = start.state;
  const results: FlowResult[] = [start];
  for (const input of inputs) {
    const r = advanceFlow(DEFAULT_FLOW, state, input, ctxWith(q, extra));
    q = { ...q, ...r.patch };
    state = r.state;
    results.push(r);
  }
  return { q, state, results, last: results[results.length - 1] };
}

const tap = (replyId: string): InboundInput => ({ replyId });
const say = (text: string): InboundInput => ({ text });

test("the default flow passes its own validation", () => {
  assert.deepEqual(validateFlow(DEFAULT_FLOW), []);
});

test("default flow respects WhatsApp limits in both languages", () => {
  for (const step of DEFAULT_FLOW.steps) {
    for (const lang of ["en", "ar"] as const) {
      assert.ok(step.ask[lang].length <= WA_LIMITS.body, step.id);
      for (const o of step.options) {
        const max = step.style === "buttons" ? WA_LIMITS.buttonTitle : WA_LIMITS.rowTitle;
        assert.ok(o.title[lang].length <= max, `${step.id}/${o.id} ${lang}: "${o.title[lang]}"`);
      }
    }
    if (step.style === "buttons") assert.ok(step.options.length <= WA_LIMITS.buttons, step.id);
    if (step.style === "list") assert.ok(step.options.length <= WA_LIMITS.listRows, step.id);
  }
  // Rendered messages, booking list included, in both languages.
  for (const lang of ["en", "ar"] as const) {
    const { results } = play([tap(lang), tap("buy"), tap("invest"), tap("b2"), tap("apartment"), tap("br2"), tap("cash"), tap("now")], lang);
    for (const r of results) {
      for (const m of r.messages) {
        assert.ok(m.body.length <= WA_LIMITS.body);
        if (m.kind === "buttons") {
          assert.ok(m.buttons.length <= WA_LIMITS.buttons);
          for (const b of m.buttons) assert.ok(b.title.length <= WA_LIMITS.buttonTitle, b.title);
        }
        if (m.kind === "list") {
          assert.ok(m.rows.length <= WA_LIMITS.listRows);
          assert.ok(m.buttonLabel.length <= WA_LIMITS.buttonTitle);
          for (const row of m.rows) assert.ok(row.title.length <= WA_LIMITS.rowTitle, row.title);
        }
      }
    }
  }
});

test("greeting says it's automated, names the org and asks for a language", () => {
  const r = startFlow(DEFAULT_FLOW, "en", ctxWith());
  assert.match(r.messages[0].body, /automated assistant for Demo Realty/);
  assert.match(r.messages[0].body, /Marina Crest/);
  const ask = r.messages[1];
  assert.equal(ask.kind, "buttons");
  assert.deepEqual(ask.kind === "buttons" && ask.buttons.map((b) => b.title), ["English", "العربية"]);
  assert.equal(r.state.stepId, "language");

  const ar = startFlow(DEFAULT_FLOW, "ar", ctxWith({}, { projectName: null }));
  assert.match(ar.messages[0].body, /المساعد الآلي/);
  assert.match(ar.messages[0].body, /عقاراتنا/);
});

test("a buyer goes through every question and books a slot", () => {
  const { q, last, results, state } = play([tap("en"), tap("buy"), tap("live"), tap("b2"), tap("apartment"), tap("br2"), tap("mortgage"), tap("1-3m")]);
  assert.deepEqual(q, { intent: "buy", purpose: "live", budgetMin: 1_000_000, budgetMax: 2_000_000, propertyType: "apartment", bedrooms: 2, payment: "mortgage", timeline: "1-3m" });
  assert.equal(state.stepId, "booking");
  const list = last.messages[0];
  assert.equal(list.kind, "list");
  if (list.kind === "list") {
    assert.equal(list.rows.length, 10); // 9 slots + call me
    assert.equal(list.rows[0].id, "slot:s1");
    assert.equal(list.rows[0].title, "Fri 23 Oct, 11:00 am");
    assert.equal(list.rows[9].id, "call");
  }
  assert.equal(results.length, 9);

  const ctx = ctxWith(q);
  const booked = advanceFlow(DEFAULT_FLOW, state, tap("slot:s2"), ctx);
  assert.deepEqual(booked.booking, { slotId: "s2" });
  assert.equal(booked.state.stepId, null);
  assert.match(booked.messages[0].body, /Fri 23 Oct, 4:00 pm/);
  assert.match(booked.messages[1].body, /Thanks! Our team at Demo Realty/);
});

test("renters skip purpose and payment and see yearly rent bands", () => {
  const { q, results } = play([tap("en"), tap("rent")]);
  assert.equal(q.intent, "rent");
  const ask = results[2].messages[0];
  assert.equal(ask.kind, "list");
  assert.match(ask.body, /yearly rent/);
  const after = play([tap("en"), tap("rent"), tap("r2"), tap("villa"), tap("br3")]);
  assert.deepEqual(after.q, { intent: "rent", budgetMin: 60_000, budgetMax: 100_000, propertyType: "villa", bedrooms: 3 });
  assert.equal(after.state.stepId, "timeline");
});

test("browsing leads skip to the end", () => {
  const { q, last } = play([tap("en"), tap("browsing")]);
  assert.equal(q.intent, "browsing");
  assert.equal(last.state.stepId, null);
  assert.match(last.messages[0].body, /Thanks!/);
});

test("Arabic leads get Arabic questions and typed Arabic answers work", () => {
  const { q, results, state } = play([
    say("عربي"),
    say("ابي اشتري"),
    say("للاستثمار"),
    say("حدود مليون ونص"),
    say("فيلا"),
    say("غرفتين"),
    say("كاش"),
    say("خلال شهرين"),
  ]);
  assert.equal(results[1].state.lang, "ar");
  assert.match(results[1].messages[0].body, /تشتري ولا تستأجر/);
  assert.deepEqual(q, { intent: "buy", purpose: "invest", budgetMin: 1_000_000, budgetMax: 2_000_000, propertyType: "villa", bedrooms: 2, payment: "cash", timeline: "1-3m" });
  assert.equal(state.stepId, "booking");
  const list = results[results.length - 1].messages[0];
  assert.equal(list.kind === "list" && list.buttonLabel, "اختر الوقت");
  assert.equal(list.kind === "list" && list.rows[0].title, "الجمعة 23/10، 11:00 ص");
});

test("Arabic-Indic digits and Gulf phrasing", () => {
  const rent = play([say("العربية"), say("إيجار"), say("٨٠ ألف"), say("شقة"), say("٣ غرف"), say("مو مستعجل")]);
  assert.deepEqual(rent.q, { intent: "rent", budgetMin: 60_000, budgetMax: 100_000, propertyType: "apartment", bedrooms: 3, timeline: "later" });
  const buy = play([say("arabic"), say("شراء"), say("للسكن"), say("مليونين")]);
  assert.equal(buy.q.budgetMax, 2_000_000);
  const now = play([say("en"), say("rent"), say("120k"), say("any"), say("studio"), say("الحين")]);
  assert.equal(now.q.timeline, "now");
});

test("English typed answers: keywords, numbers and amounts", () => {
  const { q } = play([say("English please"), say("I want to buy"), say("investment"), say("around 1.5M"), say("a flat"), say("2 bed"), say("bank loan"), say("next month")]);
  assert.deepEqual(q, { intent: "buy", purpose: "invest", budgetMin: 1_000_000, budgetMax: 2_000_000, propertyType: "apartment", bedrooms: 2, payment: "mortgage", timeline: "1-3m" });

  const budgets: Array<[string, number | undefined, number | undefined]> = [
    ["AED 950k", undefined, 1_000_000],
    ["1,200,000", 1_000_000, 2_000_000],
    ["between 2 and 3 million", 2_000_000, 3_000_000],
    ["7M", 5_000_000, undefined],
    ["2", 1_000_000, 2_000_000], // second row
  ];
  for (const [text, min, max] of budgets) {
    const r = play([tap("en"), tap("buy"), tap("live"), say(text)]);
    assert.equal(r.q.budgetMin, min, text);
    assert.equal(r.q.budgetMax, max, text);
  }

  assert.equal(play([tap("en"), tap("rent"), tap("r1"), tap("villa"), say("5 bedrooms")]).q.bedrooms, 4);
  assert.equal(play([tap("en"), tap("rent"), tap("r1"), tap("villa"), say("3")]).q.bedrooms, 3); // a count, not row 3
  assert.equal(play([tap("en"), tap("rent"), tap("r1"), tap("villa"), tap("br1"), say("in 6 months")]).q.timeline, "later");
});

test("unclear answers are asked again once, then handed off", () => {
  const first = play([tap("en"), say("hmm what?")]);
  assert.equal(first.state.stepId, "intent");
  assert.equal(first.state.retries, 1);
  assert.match(first.last.messages[0].body, /didn't catch that/);
  assert.equal(first.last.messages[1].kind, "buttons");
  assert.equal(first.last.handoff, false);

  const second = play([tap("en"), say("hmm what?"), say("buy or rent, both")]);
  assert.equal(second.last.handoff, true);
  assert.equal(second.state.stepId, null);
  assert.match(second.last.messages[0].body, /passing you to someone/);

  // A good answer after a retry resets the counter.
  const recovered = play([tap("en"), say("??"), say("rent")]);
  assert.equal(recovered.state.retries, 0);
  assert.equal(recovered.q.intent, "rent");
});

test("negated urgency doesn't count as urgent", () => {
  const r = play([tap("en"), tap("rent"), tap("r1"), tap("villa"), tap("br1"), say("no rush, not urgent")]);
  assert.equal(r.q.timeline, "later");
});

test("booking: call instead, typed row numbers, and no free slots", () => {
  const ready = play([tap("en"), tap("rent"), tap("r1"), tap("villa"), tap("br1"), tap("now")]);
  const ctx = ctxWith(ready.q);
  const call = advanceFlow(DEFAULT_FLOW, ready.state, say("just call me"), ctx);
  assert.equal(call.booking, null);
  assert.match(call.patch.notes ?? "", /call/);
  assert.equal(call.state.stepId, null);

  const typed = advanceFlow(DEFAULT_FLOW, ready.state, say("3"), ctx);
  assert.deepEqual(typed.booking, { slotId: "s3" });

  const arabicCall = advanceFlow(DEFAULT_FLOW, { ...ready.state, lang: "ar" }, say("اتصلوا علي"), ctx);
  assert.equal(arabicCall.booking, null);
  assert.match(arabicCall.messages[0].body, /بيتصل فيك/);

  const noSlots = play([tap("en"), tap("rent"), tap("r1"), tap("villa"), tap("br1"), tap("now")], "en", { slots: [] });
  assert.equal(noSlots.state.stepId, null);
  assert.match(noSlots.last.messages[0].body, /Thanks!/);
});

test("answers the AI already collected are not asked again", () => {
  const r = startFlow(DEFAULT_FLOW, "en", ctxWith({ intent: "buy" }));
  assert.equal(r.state.stepId, "language");
  const next = advanceFlow(DEFAULT_FLOW, r.state, tap("en"), ctxWith({ intent: "buy" }));
  assert.equal(next.state.stepId, "purpose");
  const browsing = advanceFlow(DEFAULT_FLOW, r.state, tap("en"), ctxWith({ intent: "browsing" }));
  assert.equal(browsing.state.stepId, null);
});

test("a stopped flow resumes at the next unanswered question, without using this message as the answer", () => {
  const stopped: FlowState = { stepId: null, lang: "ar", retries: 0 };
  const resumed = advanceFlow(DEFAULT_FLOW, stopped, say("rent"), ctxWith({ intent: "buy", purpose: "live" }));
  assert.equal(resumed.state.stepId, "budget_buy"); // language skipped, "rent" not taken as an answer
  assert.deepEqual(resumed.patch, {});
  assert.equal(resumed.handoff, false);
  assert.match(resumed.messages[0].body, /ميزانيتك/);

  const full: Qualification = { intent: "rent", budgetMax: 60_000, propertyType: "villa", bedrooms: 2, timeline: "now" };
  const toBooking = advanceFlow(DEFAULT_FLOW, { ...stopped, lang: "en" }, say("hi"), ctxWith(full));
  assert.equal(toBooking.state.stepId, "booking");

  for (const ctx of [ctxWith(full, { hasBooking: true }), ctxWith({ ...full, notes: "Asked for a call instead of a viewing" }), ctxWith(full, { slots: [] })]) {
    const nothing = advanceFlow(DEFAULT_FLOW, { ...stopped, lang: "en" }, say("hi again"), ctx);
    assert.equal(nothing.handoff, true);
    assert.equal(nothing.state.stepId, null);
    assert.match(nothing.messages[0].body, /A colleague will follow up/);
  }
});

test("a tapped time that's gone gets the current list, without counting a retry", () => {
  const ready = play([tap("en"), tap("rent"), tap("r1"), tap("villa"), tap("br1"), tap("now")]);
  const r = advanceFlow(DEFAULT_FLOW, ready.state, tap("slot:gone"), ctxWith(ready.q, { slots: slots.slice(1) }));
  assert.equal(r.state.retries, 0);
  assert.equal(r.state.stepId, "booking");
  assert.equal(r.booking, null);
  assert.match(r.messages[0].body, /just taken/);
  assert.equal(r.messages[1].kind === "list" && r.messages[1].rows[0].id, "slot:s2");
});

test("when every offered time is a call, the question offers a call", () => {
  const calls = slots.map((s) => ({ ...s, kind: "call" }));
  const r = play([tap("en"), tap("rent"), tap("r1"), tap("villa"), tap("br1"), tap("now")], "en", { slots: calls });
  assert.match(r.last.messages[0].body, /book a call/);
  assert.doesNotMatch(r.last.messages[0].body, /viewing/);
  const mixed = play([tap("en"), tap("rent"), tap("r1"), tap("villa"), tap("br1"), tap("now")]);
  assert.match(mixed.last.messages[0].body, /viewing/);
});

test("a missing step hands off", () => {
  const missing = advanceFlow(DEFAULT_FLOW, { stepId: "gone", lang: "en", retries: 0 }, say("hello"), ctxWith());
  assert.equal(missing.handoff, true);
});

test("validateFlow reports plain problems", () => {
  assert.equal(validateFlow(null).length, 1);
  const broken = structuredClone(DEFAULT_FLOW) as FlowDefinition;
  broken.greeting = { en: "Hello from Demo Realty", ar: "" };
  broken.start = "nowhere";
  broken.steps[1].options.push({ id: "x", title: { en: "Something else", ar: "شي ثاني" }, value: "buy" });
  broken.steps[5].options[0].title.en = "A very long apartment title here";
  broken.steps[6].options[0].value = "two";
  broken.steps[9].next = "intent"; // loop
  broken.steps[1].options[2].next = "missing";
  broken.steps[3].id = " budget_buy ";
  const problems = validateFlow(broken);
  const has = (re: RegExp) => assert.ok(problems.some((p) => re.test(p)), `${re} in ${JSON.stringify(problems, null, 1)}`);
  has(/English greeting must say it's an automated/);
  has(/Greeting \(Arabic\) is empty/);
  has(/first step/);
  has(/4 buttons; WhatsApp allows 3/);
  has(/WhatsApp allows 24/);
  has(/bedrooms must be a whole number/);
  has(/loops back/);
  has(/"missing", which doesn't exist/);
  has(/Step "budget_buy" has spaces before or after its id/);
});

test("slot titles use Dubai time", () => {
  assert.equal(formatSlot("2026-10-23T12:30:00.000Z", "en"), "Fri 23 Oct, 4:30 pm");
  assert.equal(formatSlot("2026-10-21T20:00:00.000Z", "ar"), "الخميس 22/10، 12:00 ص");
});
