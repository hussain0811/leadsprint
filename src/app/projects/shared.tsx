import type { ReactNode, Ref } from "react";
import type { Tone } from "@/components/ui";
import type { UnitStatus } from "@/lib/projects/types";

// Pieces shared by the Projects page's sections. Only client components import this file.

export type Notice = { tone: Tone; text: ReactNode } | null;

const TONE_TEXT: Record<Tone, string> = { ok: "text-ok", warn: "text-warn", bad: "text-bad", muted: "text-muted" };

// A polite live region. It stays in the page while empty so screen readers announce what appears in it.
// `reserve` keeps a line of space so the layout doesn't jump; rows in a list turn it off.
export function NoticeLine({
  notice,
  reserve = true,
  className = "",
  ref,
}: {
  notice: Notice;
  reserve?: boolean;
  className?: string;
  ref?: Ref<HTMLParagraphElement>;
}) {
  return (
    <p
      ref={ref}
      role="status"
      tabIndex={ref ? -1 : undefined}
      className={`text-[14px] leading-relaxed ${reserve ? "min-h-5" : ""} ${notice ? TONE_TEXT[notice.tone] : ""} ${className}`}
    >
      {notice?.text}
    </p>
  );
}

export function projectPath(id: string, suffix = "") {
  return `/api/projects/${encodeURIComponent(id)}${suffix}`;
}

/* ---------- Formatting ---------- */

const NUMBER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export function formatNumber(n: number) {
  return NUMBER.format(n);
}

export function count(n: number, singular: string, plural = `${singular}s`) {
  return `${formatNumber(n)} ${n === 1 ? singular : plural}`;
}

// "a, b and c"
export function listJoin(items: string[], word = "and") {
  if (items.length < 2) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${word} ${items[items.length - 1]}`;
}

export function bedroomsText(bedrooms: number) {
  return bedrooms === 0 ? "Studio" : `${bedrooms} BR`;
}

export const STATUS_TONE: Record<UnitStatus, Tone> = { available: "ok", reserved: "warn", sold: "muted" };

const DAY = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", weekday: "long", day: "numeric", month: "long" });

export function formatDubaiDay(iso: string) {
  return DAY.format(new Date(iso));
}

// "2,350,000" from what people type: commas, spaces and "AED" are fine. Blank or unreadable gives null.
export function readAmount(text: string): number | null {
  const cleaned = text.replace(/aed/i, "").replace(/[,\s]/g, "");
  if (!cleaned || !/^\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

export function errorText(err: unknown) {
  if (err instanceof TypeError && /fetch|network|load failed/i.test(err.message)) {
    return "Couldn't reach LeadSprint. Check the app is still running, then try again.";
  }
  return err instanceof Error ? err.message : String(err);
}

// A control that is disabled while a request runs loses keyboard focus to the page. Once the request
// is over (and the control enabled again, so call this after a flushSync), put focus somewhere useful.
export function restoreFocus(target: HTMLElement | null | undefined) {
  const active = document.activeElement;
  if (!active || active === document.body) target?.focus();
}
