import { toWesternDigits } from "./guard";
import { DEFAULT_SETTINGS, WA_LIMITS } from "./types";
import type { OrgSettings } from "./types";

type NumericSetting = "maxMessageChars" | "leadMessagesPerMinute" | "strikeLimit" | "offTopicStreakForStrike" | "leadTokenBudget" | "monthlyTokenBudget" | "maxReplyChars";

/** Allowed range per number setting. readSettings clamps stored values; PUT /api/settings refuses values outside. */
export const SETTINGS_LIMITS: Record<NumericSetting, { min: number; max: number }> = {
  maxMessageChars: { min: 50, max: 4000 },
  leadMessagesPerMinute: { min: 1, max: 60 },
  strikeLimit: { min: 1, max: 20 },
  offTopicStreakForStrike: { min: 1, max: 50 },
  leadTokenBudget: { min: 1_000, max: 10_000_000 },
  monthlyTokenBudget: { min: 10_000, max: 1_000_000_000 },
  maxReplyChars: { min: 100, max: WA_LIMITS.body },
};

const isRecord =(v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

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
  const num = (key: NumericSetting) => int(o[key], d[key], SETTINGS_LIMITS[key].min, SETTINGS_LIMITS[key].max);
  return {
    maxMessageChars: num("maxMessageChars"),
    leadMessagesPerMinute: num("leadMessagesPerMinute"),
    strikeLimit: num("strikeLimit"),
    offTopicStreakForStrike: num("offTopicStreakForStrike"),
    leadTokenBudget: num("leadTokenBudget"),
    monthlyTokenBudget: num("monthlyTokenBudget"),
    scopeCheck: typeof o.scopeCheck === "boolean" ? o.scopeCheck : d.scopeCheck,
    maxReplyChars: num("maxReplyChars"),
    allowedLinkDomains: domains(o.allowedLinkDomains),
    allowedPhones: phones(o.allowedPhones),
  };
}
