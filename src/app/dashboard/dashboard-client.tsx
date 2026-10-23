"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Button, Section, StatusMark } from "@/components/ui";
import { apiFetch } from "@/lib/api-client";
import { BUSINESS_TIME_ZONE, formatDuration } from "@/lib/dashboard/metrics";
import { PERIOD_LABELS, PERIODS, type DashboardData, type Period } from "@/lib/dashboard/types";
import { timeAgo } from "@/lib/time";
import { BarChart } from "./bar-chart";

const LINK = "text-marina underline-offset-4 hover:underline";

const num = (n: number) => n.toLocaleString("en-US");
const pct = (rate: number | null) => (rate === null ? "–" : `${Math.round(rate * 100)}%`);

const when = new Intl.DateTimeFormat("en-GB", {
  timeZone: BUSINESS_TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function errorText(err: unknown) {
  if (err instanceof TypeError && /fetch|network|load failed/i.test(err.message)) {
    return "Couldn't reach LeadSprint. Check the app is still running, then try again.";
  }
  return err instanceof Error ? err.message : String(err);
}

export function DashboardClient() {
  const [period, setPeriod] = useState<Period>("7d");
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<DashboardData | null>(null);
  // Which request (period and attempt) the shown data or error answers; anything else is still loading.
  const [settled, setSettled] = useState<{ key: string; error: string | null } | null>(null);
  const key = `${period}:${attempt}`;
  const loading = settled?.key !== key;
  const error = loading ? null : settled.error;

  useEffect(() => {
    let current = true;
    apiFetch<DashboardData>(`/api/dashboard?period=${period}`).then(
      (res) => {
        if (!current) return;
        setData(res);
        setSettled({ key: `${period}:${attempt}`, error: null });
      },
      (err: unknown) => {
        if (current) setSettled({ key: `${period}:${attempt}`, error: errorText(err) });
      },
    );
    return () => {
      current = false;
    };
  }, [period, attempt]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line py-5">
        <PeriodPicker value={period} onChange={setPeriod} />
        <p role="status" className="text-[13px] text-muted">
          {loading ? (data ? "Updating…" : "") : data ? "Times are Dubai time." : ""}
        </p>
      </div>

      {error && (
        <div className="mt-6 grid justify-items-start gap-3">
          <p className="text-bad">Couldn&apos;t load the dashboard: {error}</p>
          <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
        </div>
      )}
      {!data && !error && <p className="mt-8 text-muted">Loading the dashboard…</p>}
      {data && <Dashboard data={data} />}
    </div>
  );
}

function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <fieldset className="flex items-center gap-3">
      <legend className="sr-only">Period</legend>
      <span aria-hidden className="text-[14px] text-muted">
        Show
      </span>
      <div className="inline-flex rounded-[4px] border border-line bg-panel p-0.5">
        {PERIODS.map((p) => (
          <label
            key={p}
            className={`cursor-pointer rounded-[3px] px-3 py-1.5 text-[14px] has-focus-visible:outline-2 has-focus-visible:outline-brass ${
              p === value ? "bg-marina text-on-marina" : "text-ink hover:text-marina"
            }`}
          >
            <input type="radio" name="period" value={p} checked={p === value} onChange={() => onChange(p)} className="sr-only" />
            {PERIOD_LABELS[p]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Stat({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: "warn" }) {
  return (
    <div className="min-w-[8rem]">
      <dt className="text-[14px] text-muted">{label}</dt>
      <dd className={`text-[1.75rem] font-semibold leading-tight tabular-nums ${tone === "warn" ? "text-warn" : ""}`}>{value}</dd>
      {note && <dd className="mt-0.5 text-[13px] leading-snug text-muted">{note}</dd>}
    </div>
  );
}

function Dashboard({ data }: { data: DashboardData }) {
  const { leads, response, answered } = data;
  const periodText = PERIOD_LABELS[data.period].toLowerCase();
  const setupLeft = data.setup.filter((s) => !s.done).length;

  return (
    <>
      <Section
        title="Leads"
        intro={`New leads ${data.period === "today" ? "today" : `in the ${periodText}`}, and how ready they are.`}
      >
        <dl className="flex flex-wrap gap-x-10 gap-y-5">
          <Stat label="New leads" value={num(leads.new)} />
          <Stat
            label="Qualified"
            value={pct(leads.qualifiedRate)}
            note={leads.new ? `${num(leads.qualified)} finished the questions or booked` : "No new leads yet"}
          />
          <Stat
            label="Viewings booked"
            value={num(leads.viewingsBooked)}
            note={leads.callsBooked ? `and ${num(leads.callsBooked)} call${leads.callsBooked === 1 ? "" : "s"}` : undefined}
          />
          <Stat
            label="Need a person"
            value={num(leads.needingPerson)}
            note={leads.needingPerson ? <Link href="/inbox" className={LINK}>Open the inbox</Link> : "Right now, any period"}
            tone={leads.needingPerson ? "warn" : undefined}
          />
        </dl>

        <ScoreSplit leads={leads} />

        <div className="mt-8">
          {leads.new === 0 ? (
            <p className="text-[14px] text-muted">No new leads {data.period === "today" ? "today" : "in this period"} yet.</p>
          ) : (
            <BarChart
              buckets={data.perBucket.buckets}
              unit={data.perBucket.unit}
              caption={data.perBucket.unit === "hour" ? "New leads per hour today" : "New leads per day"}
            />
          )}
        </div>
      </Section>

      <Section
        title="First response"
        intro="From a lead's first message to the first reply, by the bot or a person. The greeting doesn't count."
      >
        {response.conversations === 0 ? (
          <p className="text-[14px] text-muted">No lead has written {data.period === "today" ? "today" : "in this period"} yet.</p>
        ) : (
          <dl className="flex flex-wrap gap-x-10 gap-y-5">
            <Stat
              label="Answered within a minute"
              value={pct(response.withinMinuteRate)}
              note={`${num(response.withinMinute)} of ${num(response.conversations)} conversation${response.conversations === 1 ? "" : "s"}`}
            />
            <Stat label="Median first reply" value={response.medianMs === null ? "–" : formatDuration(response.medianMs)} />
            {response.unanswered > 0 && (
              <Stat label="Still waiting" value={num(response.unanswered)} note="No reply yet" tone="warn" />
            )}
          </dl>
        )}
      </Section>

      <Section title="Who answered" intro="Bot turns by the AI or the scripted flow, and replies a person sent after taking over.">
        <dl className="flex flex-wrap gap-x-10 gap-y-5">
          <Stat label="AI" value={num(answered.ai)} note="turns" />
          <Stat label="Scripted flow" value={num(answered.scripted)} note="turns" />
          <Stat label="A person" value={num(answered.person)} note="replies" />
        </dl>
        <ul className="mt-6 grid gap-2 text-[14px] leading-relaxed">
          <li>
            <span className="tabular-nums">{num(answered.fallbacks)}</span> AI {answered.fallbacks === 1 ? "turn" : "turns"} fell back to the
            scripted flow
          </li>
          <li>
            <span className="tabular-nums">{num(answered.offTopic)}</span> off-topic {answered.offTopic === 1 ? "message" : "messages"} steered
            back, <span className="tabular-nums">{num(answered.refused)}</span> refused before reaching the AI (too long, too fast or blocked)
          </li>
          <li>
            <span className="tabular-nums">{num(answered.strikes)}</span> {answered.strikes === 1 ? "strike" : "strikes"} across{" "}
            {num(answered.leadsWithStrikes)} {answered.leadsWithStrikes === 1 ? "lead" : "leads"} active in this period
            {answered.aiStoppedLeads > 0 && (
              <span className="text-warn">
                ; the AI stopped for {num(answered.aiStoppedLeads)} {answered.aiStoppedLeads === 1 ? "lead" : "leads"}
              </span>
            )}
          </li>
        </ul>
        <TokenMeter used={answered.tokensThisMonth} budget={answered.monthlyBudget} />
      </Section>

      <Section
        title="Setup"
        intro={setupLeft === 0 ? "Everything is in place." : `${setupLeft} ${setupLeft === 1 ? "thing" : "things"} left to set up. Each opens its page.`}
      >
        <ul className="divide-y divide-line border-y border-line">
          {data.setup.map((item) => (
            <li key={item.key}>
              <Link href={item.href} className="group flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3">
                <span className="min-w-0">
                  <span className="block font-medium group-hover:text-marina group-hover:underline underline-offset-4">{item.label}</span>
                  <span className="block text-[13px] leading-snug text-muted">{item.detail}</span>
                </span>
                <StatusMark tone={item.tone}>{item.done ? "Done" : item.tone === "bad" ? "Not working" : "To do"}</StatusMark>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Hot leads" intro="The most recent leads scored hot. Any period.">
        {data.hotLeads.length === 0 ? (
          <p className="text-[14px] text-muted">No hot leads yet.</p>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {data.hotLeads.map((lead) => (
              <li key={lead.id} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                  <Link href={`/leads/${lead.id}`} className={`font-medium ${LINK}`}>
                    {lead.name || lead.phone || "Unnamed lead"}
                  </Link>
                  <span className="text-[13px] text-muted">{timeAgo(lead.updatedAt)}</span>
                </div>
                <p className="mt-0.5 text-[13px] leading-snug text-muted">
                  {[lead.projectName, ...lead.reasons].filter(Boolean).join(" · ") || "No details yet"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Upcoming viewings" intro="The next booked viewings and calls.">
        {data.upcoming.length === 0 ? (
          <p className="text-[14px] text-muted">Nothing booked yet.</p>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {data.upcoming.map((b) => (
              <li key={b.id} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3">
                <span className="min-w-0">
                  <Link href={`/leads/${b.leadId}`} className={`font-medium ${LINK}`}>
                    {b.leadName || "Unnamed lead"}
                  </Link>
                  <span className="text-[13px] text-muted">
                    {" "}
                    · {b.kind === "call" ? "Call" : "Viewing"}
                    {b.projectName ? ` at ${b.projectName}` : ""}
                  </span>
                </span>
                <time dateTime={b.startsAt} className="text-[14px] tabular-nums">
                  {when.format(new Date(b.startsAt))}
                </time>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

function ScoreSplit({ leads }: { leads: DashboardData["leads"] }) {
  if (leads.new === 0) return null;
  const parts = [
    { label: "Hot", n: leads.hot, cls: "bg-bad" },
    { label: "Warm", n: leads.warm, cls: "bg-warn" },
    { label: "Cold", n: leads.cold, cls: "bg-marina" },
    { label: "Not scored yet", n: leads.unknown, cls: "bg-line" },
  ];
  return (
    <div className="mt-6">
      <h3 className="text-[14px] text-muted">Score of new leads</h3>
      <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-[14px]">
        {parts.map((p) => (
          <li key={p.label} className="inline-flex items-center gap-2">
            <span aria-hidden className={`size-2.5 rounded-[2px] ${p.cls}`} />
            {p.label} <span className="font-semibold tabular-nums">{num(p.n)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TokenMeter({ used, budget }: { used: number; budget: number }) {
  const share = budget > 0 ? Math.min(1, used / budget) : 0;
  const tone = share >= 1 ? "bg-bad" : share >= 0.8 ? "bg-warn" : "bg-marina";
  return (
    <div className="mt-8 max-w-md">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 text-[14px]">
        <span id="token-meter-label">AI tokens this month</span>
        <span className="tabular-nums text-muted">
          {num(used)} of {num(budget)}
        </span>
      </div>
      <div
        role="meter"
        aria-labelledby="token-meter-label"
        aria-valuemin={0}
        aria-valuemax={budget}
        aria-valuenow={Math.min(used, budget)}
        aria-valuetext={`${pct(share)} of the monthly budget`}
        className="mt-2 h-2 overflow-hidden rounded-full bg-line"
      >
        <div className={`h-full ${tone}`} style={{ width: `${share * 100}%` }} />
      </div>
      <p className="mt-1.5 text-[13px] leading-snug text-muted">
        {share >= 1 ? (
          <span className="text-warn">Used up: the scripted flow answers until next month. </span>
        ) : null}
        Change the budget in{" "}
        <Link href="/settings" className={LINK}>
          Settings
        </Link>
        .
      </p>
    </div>
  );
}
