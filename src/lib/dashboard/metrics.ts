import type { Bucket, Period } from "./types";

// Pure calculations behind the dashboard, kept apart from the database so they can be tested.

// Brokerages work in Dubai time (UTC+4, no daylight saving), so "today" starts at midnight there.
export const BUSINESS_TIME_ZONE = "Asia/Dubai";
const OFFSET_MS = 4 * 60 * 60_000;
const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

export const FAST_REPLY_MS = 60_000;

/** Midnight in Dubai at or before the given moment. */
export function startOfBusinessDay(at: Date): Date {
  return new Date(Math.floor((at.getTime() + OFFSET_MS) / DAY_MS) * DAY_MS - OFFSET_MS);
}

/** The period runs from midnight (Dubai) of its first day until now. */
export function periodRange(period: Period, now: Date): { from: Date; to: Date } {
  const today = startOfBusinessDay(now);
  const daysBack = period === "today" ? 0 : period === "7d" ? 6 : 29;
  return { from: new Date(today.getTime() - daysBack * DAY_MS), to: now };
}

const dayLabel = new Intl.DateTimeFormat("en-GB", { timeZone: BUSINESS_TIME_ZONE, weekday: "short", day: "numeric", month: "short" });
const hourLabel = new Intl.DateTimeFormat("en-GB", { timeZone: BUSINESS_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Counts per hour for today, per day otherwise, up to and including the bucket that holds `to`. */
export function bucketCounts(period: Period, from: Date, to: Date, times: Date[]): { unit: "hour" | "day"; buckets: Bucket[] } {
  const unit = period === "today" ? "hour" : "day";
  const size = unit === "hour" ? HOUR_MS : DAY_MS;
  const n = Math.max(1, Math.floor((to.getTime() - from.getTime()) / size) + 1);
  const counts = new Array<number>(n).fill(0);
  for (const t of times) {
    const i = Math.floor((t.getTime() - from.getTime()) / size);
    if (i >= 0 && i < n) counts[i] += 1;
  }
  const format = unit === "hour" ? hourLabel : dayLabel;
  return {
    unit,
    buckets: counts.map((count, i) => {
      const start = new Date(from.getTime() + i * size);
      return { start: start.toISOString(), label: format.format(start), count };
    }),
  };
}

export type MessageStamp = { direction: string; author: string; createdAt: Date };

const REPLY_AUTHORS = new Set(["bot", "ai", "agent"]);

/**
 * Time from the lead's first message to the first reply after it (bot, AI or person).
 * The greeting sent when a chat opens comes before the lead writes, so it doesn't count.
 * Returns undefined when the lead never wrote, null when nobody has replied yet.
 */
export function firstReplyMs(messages: MessageStamp[]): number | null | undefined {
  const sorted = [...messages].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const first = sorted.find((m) => m.direction === "in" && m.author === "lead");
  if (!first) return undefined;
  const reply = sorted.find((m) => m.direction === "out" && REPLY_AUTHORS.has(m.author) && m.createdAt.getTime() >= first.createdAt.getTime());
  return reply ? reply.createdAt.getTime() - first.createdAt.getTime() : null;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Share answered within a minute (unanswered ones count as slow) and the median over those answered. */
export function summarizeReplies(times: Array<number | null>) {
  const answered = times.filter((t): t is number => t !== null);
  const withinMinute = answered.filter((t) => t <= FAST_REPLY_MS).length;
  return {
    conversations: times.length,
    withinMinute,
    withinMinuteRate: times.length ? withinMinute / times.length : null,
    medianMs: median(answered),
    unanswered: times.length - answered.length,
  };
}

export type RunStamp = { outcome: string; mode: string | null };

/** Who handled each bot turn, from AgentRun rows. Person replies are counted from messages instead. */
export function tallyRuns(runs: RunStamp[]) {
  const t = { ai: 0, scripted: 0, fallbacks: 0, offTopic: 0, refused: 0 };
  for (const r of runs) {
    if (r.mode === "ai") t.ai += 1;
    else if (r.mode === "scripted") t.scripted += 1;
    if (r.outcome === "fallback" || r.outcome === "error") t.fallbacks += 1;
    else if (r.outcome === "off_topic") t.offTopic += 1;
    else if (r.outcome === "blocked") t.refused += 1;
  }
  return t;
}

/** A lead counts as qualified once the flow finished with it, or it booked a viewing or call. */
export function isQualified(lead: { status: string; activeBookings: number }): boolean {
  return lead.status === "qualified" || lead.activeBookings > 0;
}

export function parseStringArray(raw: string | null | undefined): string[] {
  try {
    const v: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** "42 s", "3 min 10 s", "2 h 5 min". */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (ms < 1000) return "under 1 s";
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  return `${Math.round(h / 24)} days`;
}
