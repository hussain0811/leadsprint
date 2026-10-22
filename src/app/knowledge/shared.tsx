import Link from "next/link";
import { useEffect, useId, useState, type ReactNode, type Ref } from "react";
import { Select, type Tone } from "@/components/ui";
import type { ProjectOption, SourceRole } from "@/lib/knowledge/types";

// Pieces shared by the Knowledge page's sections. Only client components import this file.

export type Notice = { tone: Tone; text: ReactNode } | null;

const TONE_TEXT: Record<Tone, string> = { ok: "text-ok", warn: "text-warn", bad: "text-bad", muted: "text-muted" };
const TONE_DOT: Record<Tone, string> = { ok: "bg-ok", warn: "bg-warn", bad: "bg-bad", muted: "bg-muted/50" };

export const LINK = "text-marina underline underline-offset-2";

export function Section({
  title,
  intro,
  aside,
  children,
}: {
  title: string;
  intro: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="grid gap-6 border-b border-line py-9 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] md:gap-12"
    >
      <div>
        <h2 id={headingId} className="text-lg font-semibold">
          {title}
        </h2>
        <div className="mt-2 text-[14px] leading-relaxed text-muted">{intro}</div>
        {aside && <div className="mt-5">{aside}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

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

// Like StatusMark, but for a sentence that may wrap: the dot stays beside the first line.
export function StatusLine({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-[14px] leading-relaxed">
      <span aria-hidden className={`mt-[0.4375rem] size-2 shrink-0 rounded-full ${TONE_DOT[tone]}`} />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

// Where a passage sits in its document: "Page 3, Payment plan". Headings can be Arabic, so they're isolated.
export function PlaceLabel({ page, heading }: { page: number | null; heading: string | null }) {
  return (
    <>
      {page !== null && `Page ${page}`}
      {page !== null && heading && ", "}
      {heading && <bdi>{heading}</bdi>}
    </>
  );
}

export function ConnectionsLink() {
  return (
    <Link href="/connections" className={LINK}>
      Connections
    </Link>
  );
}

/* ---------- Pickers ---------- */

export function ProjectSelect({
  id,
  value,
  onChange,
  projects,
}: {
  id: string;
  value: string; // "" = all projects
  onChange: (projectId: string) => void;
  projects: ProjectOption[];
}) {
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">All projects</option>
      {projects.map((project) => (
        <option key={project.id} value={project.id}>
          {project.name}
        </option>
      ))}
    </Select>
  );
}

const ROLE_TEXT: Record<SourceRole, { label: string; help: string }> = {
  reference: { label: "Reference", help: "Searched when a question needs it, like brochures and payment plans." },
  rules: { label: "Rules", help: "Applied to every AI reply, like terms and conditions or what never to promise." },
};

export function RoleChoice({
  value,
  onChange,
  rulesLeft,
  compact = false,
}: {
  value: SourceRole;
  onChange: (role: SourceRole) => void;
  rulesLeft?: number; // characters left under the rules limit, shown beside the rules option
  compact?: boolean; // labels only, for inline edit forms
}) {
  const name = useId();
  return (
    <fieldset className="min-w-0">
      <legend className="text-[14px] font-medium">Use it as</legend>
      <div className={compact ? "mt-2 flex flex-wrap gap-x-6 gap-y-2" : "mt-2 grid gap-3"}>
        {(["reference", "rules"] as const).map((role) => (
          <label key={role} className="flex cursor-pointer items-start gap-2.5 text-[14px] leading-relaxed">
            <input
              type="radio"
              name={name}
              value={role}
              checked={value === role}
              onChange={() => onChange(role)}
              className="mt-[0.3125rem] accent-marina"
            />
            <span className="min-w-0">
              <span className={`font-medium ${role === "rules" ? "text-brass" : ""}`}>{ROLE_TEXT[role].label}</span>
              {!compact && (
                <span className="block text-[13px] leading-snug text-muted">
                  {ROLE_TEXT[role].help}
                  {role === "rules" && rulesLeft !== undefined && (
                    <> {rulesLeft > 0 ? `${formatNumber(rulesLeft)} characters left.` : "The rules limit is used up."}</>
                  )}
                </span>
              )}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/* ---------- Timing ---------- */

// Whole seconds since `since` (a Date.now() timestamp taken in an event handler), ticking while it's set.
export function useElapsed(since: number | null) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (since === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);
  return since === null ? 0 : Math.max(0, Math.floor((now - since) / 1000));
}

/* ---------- Formatting ---------- */

const NUMBER = new Intl.NumberFormat("en-US");

export function formatNumber(n: number) {
  return NUMBER.format(n);
}

export function count(n: number, singular: string, plural = `${singular}s`) {
  return `${formatNumber(n)} ${n === 1 ? singular : plural}`;
}

// "a, b or c"
export function listJoin(items: string[], word = "and") {
  if (items.length < 2) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${word} ${items[items.length - 1]}`;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

export function formatSeconds(ms: number) {
  return `${(ms / 1000).toFixed(1)} s`;
}

// Valid-until values are calendar dates, so read and show them in UTC to avoid an off-by-one day.
export function toDateInput(iso: string | null) {
  return iso ? iso.slice(0, 10) : "";
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

// True once a valid-until date has passed. The server counts the date through the end of that day
// in UTC, so compare against today's UTC date. Only called after data loads in the browser.
export function isPastDate(iso: string) {
  return toDateInput(iso) < new Date().toISOString().slice(0, 10);
}

// Processing normally takes seconds. A source still "processing" after this long was most likely
// interrupted (the server restarted, say), so stop waiting for it and let the admin reprocess it.
export const STUCK_AFTER_MS = 5 * 60 * 1000;

export function isStuck(source: { status: string; updatedAt: string }) {
  return source.status === "processing" && Date.now() - new Date(source.updatedAt).getTime() > STUCK_AFTER_MS;
}

// Ends a message from the server with a full stop if it doesn't have one.
export function sentence(text: string | null | undefined) {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return "";
  return /[.!?؟]$/.test(trimmed) ? trimmed : `${trimmed}.`;
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

export function sourcePath(id: string, suffix = "") {
  return `/api/knowledge/sources/${encodeURIComponent(id)}${suffix}`;
}
