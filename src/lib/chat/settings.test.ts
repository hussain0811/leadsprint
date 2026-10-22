import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeDomain, readSettings } from "./settings";
import { DEFAULT_SETTINGS } from "./types";

test("missing or broken JSON gives the defaults", () => {
  assert.deepEqual(readSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(readSettings(undefined), DEFAULT_SETTINGS);
  assert.deepEqual(readSettings(""), DEFAULT_SETTINGS);
  assert.deepEqual(readSettings("{not json"), DEFAULT_SETTINGS);
  assert.deepEqual(readSettings("[1,2]"), DEFAULT_SETTINGS);
});

test("keeps good values and fills gaps", () => {
  const s = readSettings(JSON.stringify({ strikeLimit: 5, scopeCheck: false }));
  assert.equal(s.strikeLimit, 5);
  assert.equal(s.scopeCheck, false);
  assert.equal(s.maxMessageChars, DEFAULT_SETTINGS.maxMessageChars);
});

test("clamps and repairs bad values", () => {
  const s = readSettings(
    JSON.stringify({
      maxMessageChars: 10,
      leadMessagesPerMinute: -3,
      strikeLimit: "4",
      offTopicStreakForStrike: 2.6,
      leadTokenBudget: "lots",
      monthlyTokenBudget: 1e15,
      scopeCheck: "yes",
      maxReplyChars: 99_999,
    }),
  );
  assert.equal(s.maxMessageChars, 50);
  assert.equal(s.leadMessagesPerMinute, 1);
  assert.equal(s.strikeLimit, 4);
  assert.equal(s.offTopicStreakForStrike, 3);
  assert.equal(s.leadTokenBudget, DEFAULT_SETTINGS.leadTokenBudget);
  assert.equal(s.monthlyTokenBudget, 1_000_000_000);
  assert.equal(s.scopeCheck, DEFAULT_SETTINGS.scopeCheck);
  assert.equal(s.maxReplyChars, 1024);
});

test("cleans link domains and phone numbers", () => {
  const s = readSettings(
    JSON.stringify({
      allowedLinkDomains: ["https://www.Demo-Realty.example/en/", "demo-realty.example", "not a domain", 42, "marina-crest.ae:443"],
      allowedPhones: ["+971 4 123 4567", "+971-4-123-4567", "٠٥٠١٢٣٤٥٦٧", "123", "call us"],
    }),
  );
  assert.deepEqual(s.allowedLinkDomains, ["demo-realty.example", "marina-crest.ae"]);
  assert.deepEqual(s.allowedPhones, ["+971 4 123 4567", "0501234567"]);
  assert.equal(readSettings(JSON.stringify({ allowedPhones: "x" })).allowedPhones.length, 0);
  assert.equal(normalizeDomain("localhost"), null);
});
