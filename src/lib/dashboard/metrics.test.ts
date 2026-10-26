import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bucketCounts,
  firstReplyMs,
  formatDuration,
  isQualified,
  median,
  parseStringArray,
  periodRange,
  startOfBusinessDay,
  summarizeReplies,
  tallyRuns,
} from "./metrics";
import { isPeriod } from "./types";

test("the business day starts at midnight Dubai time (20:00 UTC the day before)", () => {
  assert.equal(startOfBusinessDay(new Date("2026-10-22T10:00:00Z")).toISOString(), "2026-10-21T20:00:00.000Z");
  // 21:30 UTC is already 01:30 the next day in Dubai.
  assert.equal(startOfBusinessDay(new Date("2026-10-22T21:30:00Z")).toISOString(), "2026-10-22T20:00:00.000Z");
});

test("periods run from midnight of their first day until now", () => {
  const now = new Date("2026-10-22T10:00:00Z");
  assert.equal(periodRange("today", now).from.toISOString(), "2026-10-21T20:00:00.000Z");
  assert.equal(periodRange("7d", now).from.toISOString(), "2026-10-15T20:00:00.000Z");
  assert.equal(periodRange("30d", now).from.toISOString(), "2026-09-22T20:00:00.000Z");
  assert.equal(periodRange("7d", now).to, now);
});

test("leads are counted per day, including empty days, up to today", () => {
  const now = new Date("2026-10-22T10:00:00Z");
  const { from, to } = periodRange("7d", now);
  const { unit, buckets } = bucketCounts("7d", from, to, [
    new Date("2026-10-16T08:00:00Z"),
    new Date("2026-10-22T09:00:00Z"),
    new Date("2026-10-22T09:30:00Z"),
    new Date("2026-10-10T09:30:00Z"), // before the period: ignored
  ]);
  assert.equal(unit, "day");
  assert.equal(buckets.length, 7);
  assert.deepEqual(
    buckets.map((b) => b.count),
    [1, 0, 0, 0, 0, 0, 2],
  );
  assert.equal(buckets[6].label, "Thu 22 Oct");
});

test("today is counted per hour up to the current hour", () => {
  const now = new Date("2026-10-22T10:15:00Z"); // 14:15 in Dubai
  const { from, to } = periodRange("today", now);
  const { unit, buckets } = bucketCounts("today", from, to, [new Date("2026-10-22T10:05:00Z")]);
  assert.equal(unit, "hour");
  assert.equal(buckets.length, 15);
  assert.equal(buckets[0].label, "00:00");
  assert.equal(buckets[14].label, "14:00");
  assert.equal(buckets[14].count, 1);
});

const at = (s: number) => new Date(Date.UTC(2026, 9, 22, 10, 0, s));

test("first reply time ignores the greeting and starts at the lead's first message", () => {
  const ms = firstReplyMs([
    { direction: "out", author: "bot", createdAt: at(0) }, // greeting
    { direction: "in", author: "lead", createdAt: at(10) },
    { direction: "out", author: "system", createdAt: at(11) }, // admin note, not a reply
    { direction: "out", author: "ai", createdAt: at(14) },
    { direction: "in", author: "lead", createdAt: at(30) },
  ]);
  assert.equal(ms, 4000);
});

test("no lead message means no reply time; no reply yet means null", () => {
  assert.equal(firstReplyMs([{ direction: "out", author: "bot", createdAt: at(0) }]), undefined);
  assert.equal(firstReplyMs([{ direction: "in", author: "lead", createdAt: at(0) }]), null);
});

test("a person's reply counts as a reply", () => {
  assert.equal(
    firstReplyMs([
      { direction: "in", author: "lead", createdAt: at(0) },
      { direction: "out", author: "agent", createdAt: at(50) },
    ]),
    50_000,
  );
});

test("reply summary counts unanswered chats as slow and leaves them out of the median", () => {
  const s = summarizeReplies([2_000, 60_000, 90_000, null]);
  assert.equal(s.conversations, 4);
  assert.equal(s.withinMinute, 2);
  assert.equal(s.withinMinuteRate, 0.5);
  assert.equal(s.medianMs, 60_000);
  assert.equal(s.unanswered, 1);
  assert.equal(summarizeReplies([]).withinMinuteRate, null);
});

test("median of even and odd lists", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
});

test("turns are tallied by who answered and what went wrong", () => {
  const t = tallyRuns([
    { outcome: "replied", mode: "ai" },
    { outcome: "off_topic", mode: "ai" },
    { outcome: "fallback", mode: "scripted" },
    { outcome: "error", mode: "scripted" },
    { outcome: "replied", mode: "scripted" },
    { outcome: "blocked", mode: "none" },
    { outcome: "human", mode: "human" },
  ]);
  assert.deepEqual(t, { ai: 2, scripted: 3, fallbacks: 2, offTopic: 1, refused: 1 });
});

test("qualified means the flow finished or a viewing was booked, but not just browsing", () => {
  assert.equal(isQualified({ status: "qualified", activeBookings: 0 }), true);
  assert.equal(isQualified({ status: "qualified", activeBookings: 0, intent: "browsing" }), false);
  assert.equal(isQualified({ status: "qualified", activeBookings: 1, intent: "browsing" }), true);
  assert.equal(isQualified({ status: "handed_off", activeBookings: 1 }), true);
  assert.equal(isQualified({ status: "qualifying", activeBookings: 0 }), false);
});

test("durations read naturally", () => {
  assert.equal(formatDuration(8), "under 1 s");
  assert.equal(formatDuration(4_200), "4 s");
  assert.equal(formatDuration(190_000), "3 min 10 s");
  assert.equal(formatDuration(120_000), "2 min");
  assert.equal(formatDuration(7_500_000), "2 h 5 min");
  assert.equal(formatDuration(5 * 86_400_000), "5 days");
});

test("helpers reject bad input", () => {
  assert.deepEqual(parseStringArray('["a", 2, "b"]'), ["a", "b"]);
  assert.deepEqual(parseStringArray("not json"), []);
  assert.equal(isPeriod("7d"), true);
  assert.equal(isPeriod("90d"), false);
});
