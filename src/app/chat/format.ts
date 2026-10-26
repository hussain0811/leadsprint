import { useEffect, useState } from "react";
import type { ConversationView, Qualification } from "@/lib/chat/types";

// Small helpers shared by the chat tester's client components.

export function errorText(err: unknown) {
  if (err instanceof TypeError && /fetch|network|load failed/i.test(err.message)) {
    return "Couldn't reach LeadSprint. Check the app is still running, then try again.";
  }
  return err instanceof Error ? err.message : String(err);
}

export function conversationPath(id: string, suffix = "") {
  return `/api/chat/conversations/${encodeURIComponent(id)}${suffix}`;
}

// Whole seconds since `since` (a Date.now() taken in an event handler), ticking while it's set.
export function useElapsed(since: number | null) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (since === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);
  return since === null ? 0 : Math.max(0, Math.floor((now - since) / 1000));
}

// The current time, refreshed every `everyMs`. Starts at the time of the first render in the browser.
export function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

export function clockTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function dateTime(iso: string) {
  return new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

const NUMBER = new Intl.NumberFormat("en-US");

export function formatNumber(n: number) {
  return NUMBER.format(n);
}

// 1000000 -> "1M", 1500000 -> "1.5M", 60000 -> "60K"
function shortAmount(n: number) {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${+(n / 1_000).toFixed(0)}K`;
  return formatNumber(n);
}

// The 24-hour window: WhatsApp lets a business send free-form messages only within 24 hours of the lead's last message.
export function windowState(view: ConversationView, now: number): { open: boolean; text: string } {
  if (!view.windowOpenUntil) return { open: false, text: "Window closed: the lead hasn't written yet. Only approved templates can start a chat." };
  const left = new Date(view.windowOpenUntil).getTime() - now;
  if (left <= 0) return { open: false, text: "Window closed: over 24 hours since the lead's last message. Only approved templates can be sent." };
  const hours = Math.floor(left / 3_600_000);
  const minutes = Math.floor((left % 3_600_000) / 60_000);
  return { open: true, text: `24-hour window open, closes in ${hours > 0 ? `${hours} h ` : ""}${minutes} min` };
}

/* ---------- Qualification, in plain words ---------- */

const CHOICE_TEXT: Record<string, Record<string, string>> = {
  intent: { buy: "Buy", rent: "Rent", browsing: "Just browsing" },
  purpose: { live: "To live in", invest: "To invest" },
  propertyType: { apartment: "Apartment", villa: "Villa", townhouse: "Townhouse", penthouse: "Penthouse", any: "Any" },
  payment: { cash: "Cash", mortgage: "Mortgage" },
  timeline: { now: "Now", "1-3m": "In 1 to 3 months", later: "Later" },
};

export function qualificationRows(q: Qualification): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  const choice = (field: keyof typeof CHOICE_TEXT, value: string | undefined) =>
    value === undefined ? undefined : (CHOICE_TEXT[field][value] ?? value);
  const add = (label: string, value: string | undefined) => value !== undefined && rows.push([label, value]);

  add("Wants to", choice("intent", q.intent));
  add("Purpose", choice("purpose", q.purpose));
  if (q.budgetMin !== undefined || q.budgetMax !== undefined) {
    // "AED 1M–2M", "Up to AED 1M", "From AED 5M"
    const min = q.budgetMin ? shortAmount(q.budgetMin) : null;
    const max = q.budgetMax !== undefined ? shortAmount(q.budgetMax) : null;
    add("Budget", min && max ? `AED ${min}–${max}` : min ? `From AED ${min}` : `Up to AED ${max}`);
  }
  add("Property", choice("propertyType", q.propertyType));
  if (q.bedrooms !== undefined) add("Bedrooms", q.bedrooms === 0 ? "Studio" : String(q.bedrooms));
  add("Payment", choice("payment", q.payment));
  add("Timeline", choice("timeline", q.timeline));
  add("Area", q.area);
  add("Notes", q.notes);
  return rows;
}
