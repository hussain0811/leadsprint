import assert from "node:assert/strict";
import { test } from "node:test";
import { formatAed, scoreLead } from "./scoring";

test("nothing yet is unknown", () => {
  assert.deepEqual(scoreLead({}), { score: "unknown", reasons: ["Not enough answers yet"] });
});

test("buyer with budget and a near timeline is hot", () => {
  const r = scoreLead({ intent: "buy", budgetMin: 1_000_000, budgetMax: 2_000_000, timeline: "1-3m", payment: "cash" });
  assert.equal(r.score, "hot");
  assert.deepEqual(r.reasons, ["Wants to buy", "Budget AED 1M-2M", "Paying cash", "Buying within 3 months"]);
});

test("renter this month with a budget is hot, yearly budget shown", () => {
  const r = scoreLead({ intent: "rent", budgetMax: 60_000, timeline: "now", bedrooms: 0, propertyType: "apartment" });
  assert.equal(r.score, "hot");
  assert.ok(r.reasons.includes("Budget up to AED 60K a year"));
  assert.ok(r.reasons.includes("Renting this month"));
  assert.ok(r.reasons.includes("Looking for studio"));
});

test("later or missing pieces is warm, with the gaps named", () => {
  const later = scoreLead({ intent: "buy", budgetMin: 5_000_000, timeline: "later" });
  assert.equal(later.score, "warm");
  assert.ok(later.reasons.includes("Budget above AED 5M"));
  assert.ok(later.reasons.includes("Not in a hurry"));

  const missing = scoreLead({ intent: "rent", timeline: "now" });
  assert.equal(missing.score, "warm");
  assert.ok(missing.reasons.includes("No budget yet"));

  const noTimeline = scoreLead({ intent: "buy", budgetMax: 1_000_000 });
  assert.equal(noTimeline.score, "warm");
  assert.ok(noTimeline.reasons.includes("No timeline yet"));
});

test("just browsing is cold", () => {
  assert.equal(scoreLead({ intent: "browsing" }).score, "cold");
  assert.equal(scoreLead({ intent: "browsing", budgetMax: 2_000_000, timeline: "now" }).score, "cold");
});

test("facts without buy or rent are warm", () => {
  const r = scoreLead({ bedrooms: 2, propertyType: "villa" });
  assert.equal(r.score, "warm");
  assert.deepEqual(r.reasons, ["Looking for 2-bedroom villa", "Buy or rent not known yet"]);
});

test("formats AED amounts", () => {
  assert.equal(formatAed(950_000), "950K");
  assert.equal(formatAed(1_450_000), "1.45M");
  assert.equal(formatAed(2_000_000), "2M");
});
