import { toWesternDigits } from "./guard";
import { DEFAULT_SETTINGS, WA_LIMITS } from "./types";
import type { OrgSettings } from "./types";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function int(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** "https://www.Demo-Realty.example/path" -> "demo-realty.example"; null when it isn't a domain. */
export function normalizeDomain(input: string): string | null {
  const host = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "")
    .replace(/^www\./, "")
    .replace(/\.$/, "");
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(host) ? host : null;
}

function domains(v: unknown): string[] {
  if (!Array.isArray(v)) return DEFAULT_SETTINGS.allowedLinkDomains;
  const out = new Set<string>();
  for (const d of v) {
    const host = typeof d === "string" ? normalizeDomain(d) : null;
    if (host) out.add(host);
  }
  return [...out].slice(0, 20);
}

function phones(v: unknown): string[] {
  if (!Array.isArray(v)) return DEFAULT_SETTINGS.allowedPhones;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of v) {
    if (typeof p !== "string") continue;
    const phone = toWesternDigits(p).trim().replace(/\s+/g, " ");
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15 || !/^[+\d][\d\s\-()]*$/.test(phone) || seen.has(digits)) continue;
    seen.add(digits);
    out.push(phone);
  }
  return out.slice(0, 20);
}

/** Reads Org.settings JSON, filling gaps and clamping bad values with DEFAULT_SETTINGS. */
export function readSettings(json: string | null | undefined): OrgSettings {
  let parsed: unknown = null;
  if (json) {
    try {
      parsed = JSON.parse(json);
    } catch {
      parsed = null;
    }
  }
  const o = isRecord(parsed) ? parsed : {};
  const d = DEFAULT_SETTINGS;
  return {
    maxMessageChars: int(o.maxMessageChars, d.maxMessageChars, 50, 4000),
    leadMessagesPerMinute: int(o.leadMessagesPerMinute, d.leadMessagesPerMinute, 1, 60),
    strikeLimit: int(o.strikeLimit, d.strikeLimit, 1, 20),
    offTopicStreakForStrike: int(o.offTopicStreakForStrike, d.offTopicStreakForStrike, 1, 50),
    leadTokenBudget: int(o.leadTokenBudget, d.leadTokenBudget, 1_000, 10_000_000),
    monthlyTokenBudget: int(o.monthlyTokenBudget, d.monthlyTokenBudget, 10_000, 1_000_000_000),
    scopeCheck: typeof o.scopeCheck === "boolean" ? o.scopeCheck : d.scopeCheck,
    maxReplyChars: int(o.maxReplyChars, d.maxReplyChars, 100, WA_LIMITS.body),
    allowedLinkDomains: domains(o.allowedLinkDomains),
    allowedPhones: phones(o.allowedPhones),
  };
}
