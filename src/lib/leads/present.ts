import type { Qualification, Score } from "@/lib/chat/types";
import type { Tone } from "@/components/ui";

// Plain-language labels for leads, shared by the list, the detail page and the CSV export. No server-only imports.

export const SCORE_LABEL: Record<Score, string> = { hot: "Hot", warm: "Warm", cold: "Cold", unknown: "Unknown" };
export const SCORE_TONE: Record<Score, Tone> = { hot: "bad", warm: "warn", cold: "ok", unknown: "muted" };

export const STATUS_LABEL: Record<string, string> = {
  new: "New",
  qualifying: "Qualifying",
  qualified: "Qualified",
  handed_off: "With a person",
  closed: "Closed",
};

export const SOURCE_LABEL: Record<string, string> = {
  simulator: "Chat tester",
  web: "Website",
  form: "Form",
  webhook: "Webhook",
  csv: "CSV import",
};

export const KIND_LABEL: Record<string, string> = { viewing: "Viewing", call: "Call" };
export const BOOKING_STATUS_LABEL: Record<string, string> = { booked: "Booked", cancelled: "Cancelled", done: "Done" };

export function statusLabel(status: string) {
  return STATUS_LABEL[status] ?? status;
}

export function sourceLabel(source: string) {
  return SOURCE_LABEL[source] ?? source;
}

/** "AED 950K", "AED 1.5M". */
export function aed(n: number): string {
  if (n >= 1_000_000) return `AED ${+(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `AED ${+(n / 1_000).toFixed(0)}K`;
  return `AED ${Math.round(n)}`;
}

const CHOICES: Record<string, Record<string, string>> = {
  intent: { buy: "Buy", rent: "Rent", browsing: "Just browsing" },
  purpose: { live: "To live in", invest: "As an investment" },
  propertyType: { apartment: "Apartment", villa: "Villa", townhouse: "Townhouse", penthouse: "Penthouse", any: "Any type" },
  payment: { cash: "Cash", mortgage: "Mortgage" },
  timeline: { now: "This month", "1-3m": "In 1 to 3 months", later: "Later" },
};

function choice(field: keyof typeof CHOICES, value: string | undefined) {
  return value === undefined ? undefined : (CHOICES[field][value] ?? value);
}

export function budgetText(q: Qualification): string | undefined {
  const { budgetMin: min, budgetMax: max } = q;
  if (min === undefined && max === undefined) return undefined;
  const perYear = q.intent === "rent" ? " a year" : "";
  if (min !== undefined && max !== undefined) return min === max ? `${aed(min)}${perYear}` : `${aed(min)} to ${aed(max)}${perYear}`;
  return min !== undefined ? `From ${aed(min)}${perYear}` : `Up to ${aed(max as number)}${perYear}`;
}

export function bedroomsText(bedrooms: number | undefined): string | undefined {
  if (bedrooms === undefined) return undefined;
  if (bedrooms === 0) return "Studio";
  return `${bedrooms}${bedrooms >= 4 ? "+" : ""} bedroom${bedrooms === 1 ? "" : "s"}`;
}

/** The four answers that matter most, in one line: intent, budget, bedrooms, timeline. */
export function keyAnswers(q: Qualification): string {
  return [choice("intent", q.intent), budgetText(q), bedroomsText(q.bedrooms), choice("timeline", q.timeline)]
    .filter(Boolean)
    .join(" · ");
}

/** Every answer as a labelled row, in the order the bot asks. Missing answers are listed so gaps show. */
export function answerRows(q: Qualification): Array<{ label: string; value: string | null }> {
  return [
    { label: "Wants to", value: choice("intent", q.intent) ?? null },
    { label: "Purpose", value: choice("purpose", q.purpose) ?? null },
    { label: "Budget", value: budgetText(q) ?? null },
    { label: "Property type", value: choice("propertyType", q.propertyType) ?? null },
    { label: "Bedrooms", value: bedroomsText(q.bedrooms) ?? null },
    { label: "Payment", value: choice("payment", q.payment) ?? null },
    { label: "When", value: choice("timeline", q.timeline) ?? null },
    { label: "Area", value: q.area?.trim() || null },
    { label: "Notes", value: q.notes?.trim() || null },
  ];
}

/** "Tue 3 Nov, 10:00" in Dubai time, where viewings happen. */
export function dubaiDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Asia/Dubai",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ---------- CSV ---------- */

// Excel reads a file as UTF-8 only when it starts with a byte order mark; without it Arabic names turn to mojibake.
export const CSV_BOM = "﻿";

/**
 * One CSV cell. Text that Excel would run as a formula (starting with = + - @ or a tab/CR) gets a leading
 * apostrophe, so a lead who types "=HYPERLINK(...)" as their name can't plant a formula in the export.
 */
export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: Array<Array<string | number | boolean | null | undefined>>): string {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(","));
  return CSV_BOM + lines.join("\r\n") + "\r\n";
}
