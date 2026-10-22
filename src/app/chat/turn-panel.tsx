"use client";

import type { ReactNode } from "react";
import { StatusMark, type Tone } from "@/components/ui";
import type { ConversationView, FreeCheckResult, ScopeLabel, Score, TurnTrace } from "@/lib/chat/types";
import { dateTime, formatNumber, qualificationRows } from "./format";

const MODE: Record<TurnTrace["mode"], [Tone, string]> = {
  scripted: ["muted", "The scripted flow"],
  ai: ["ok", "The AI agent"],
  human: ["warn", "Nobody: a person has taken over"],
  none: ["muted", "Nobody: no reply was sent"],
};

const SCOPE: Record<ScopeLabel, [Tone, string]> = {
  on_topic: ["ok", "On topic"],
  small_talk: ["muted", "Small talk"],
  off_topic: ["warn", "Off topic"],
  abuse: ["bad", "Abuse"],
};

const FREE_CHECK: Record<Extract<FreeCheckResult, { ok: false }>["reason"], string> = {
  too_long: "The message was too long",
  rate_limited: "The lead sent too many messages too fast",
  abuse_pattern: "The message looked like an abuse attempt",
  blocked: "The number is blocked",
};

const SCORE: Record<Score, [Tone, string]> = {
  hot: ["ok", "Hot"],
  warm: ["warn", "Warm"],
  cold: ["muted", "Cold"],
  unknown: ["muted", "Not scored yet"],
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 py-2.5 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="min-w-0 text-[14px] leading-relaxed">{children}</dd>
    </div>
  );
}

function Json({ value }: { value: unknown }) {
  let text: string;
  try {
    text = JSON.stringify(value, null, 2) ?? "nothing";
  } catch {
    text = String(value);
  }
  return (
    <pre dir="auto" className="mt-1 max-h-60 overflow-auto rounded-[4px] bg-glass p-2 font-mono text-[12px] leading-snug whitespace-pre-wrap break-words">
      {text}
    </pre>
  );
}

export function TurnPanel({ trace }: { trace: TurnTrace | null }) {
  if (!trace) {
    return <p className="py-2.5 text-[14px] text-muted">Send a message to see how the bot decided its reply.</p>;
  }
  const [modeTone, modeText] = MODE[trace.mode];
  return (
    <dl className="divide-y divide-line">
      <Row label="Who answered">
        <StatusMark tone={modeTone}>{modeText}</StatusMark>
        <p className="text-[13px] text-muted">
          <bdi>{trace.why}</bdi>
        </p>
      </Row>
      {!trace.freeCheck.ok && (
        <Row label="Free checks">
          <StatusMark tone="bad">{FREE_CHECK[trace.freeCheck.reason]}</StatusMark>
          <p className="text-[13px] text-muted">
            {trace.freeCheck.strike ? "Counted as a strike." : "Not a strike."} No AI call was made.
          </p>
        </Row>
      )}
      <Row label="Topic">
        {trace.scope ? <StatusMark tone={SCOPE[trace.scope][0]}>{SCOPE[trace.scope][1]}</StatusMark> : <span className="text-muted">Not checked</span>}
      </Row>
      <Row label="Tool calls">
        {trace.toolCalls.length === 0 ? (
          <span className="text-muted">None</span>
        ) : (
          <ul className="grid gap-1.5">
            {trace.toolCalls.map((call, i) => (
              <li key={i}>
                <details className="group">
                  <summary className="cursor-pointer rounded-[2px] font-mono text-[13px] text-marina">{call.name}</summary>
                  <p className="mt-1.5 text-[12px] font-medium text-muted">Input</p>
                  <Json value={call.input} />
                  <p className="mt-1.5 text-[12px] font-medium text-muted">Output</p>
                  <Json value={call.output} />
                </details>
              </li>
            ))}
          </ul>
        )}
      </Row>
      <Row label="Passages used">
        {trace.passages.length === 0 ? (
          <span className="text-muted">None</span>
        ) : (
          <ul className="grid gap-0.5">
            {trace.passages.map((p, i) => (
              <li key={i}>
                <bdi>{p.title}</bdi>
                {p.page !== null && <span className="text-muted">, page {p.page}</span>}
              </li>
            ))}
          </ul>
        )}
      </Row>
      <Row label="Reply check">
        {trace.replyCheck === null ? (
          <span className="text-muted">Not run</span>
        ) : trace.replyCheck.ok ? (
          <StatusMark tone="ok">Passed</StatusMark>
        ) : (
          <>
            <StatusMark tone="bad">Blocked</StatusMark>
            <p className="text-[13px] text-muted">
              <bdi>{trace.replyCheck.reason}</bdi>
            </p>
          </>
        )}
      </Row>
      <Row label="Tokens and time">
        <span className="tabular-nums">
          {trace.tokens ? `${formatNumber(trace.tokens.input)} in, ${formatNumber(trace.tokens.output)} out` : "No AI tokens"}
          {" · "}
          {(trace.ms / 1000).toFixed(1)} s
        </span>
      </Row>
      {trace.error && (
        <Row label="Error">
          <span className="text-bad">
            <bdi>{trace.error}</bdi>
          </span>
        </Row>
      )}
    </dl>
  );
}

export function LeadPanel({ view, strikeLimit }: { view: ConversationView; strikeLimit: number | null }) {
  const lead = view.lead;
  const rows = qualificationRows(lead.qualification);
  const [scoreTone, scoreText] = SCORE[lead.score];
  return (
    <dl className="divide-y divide-line">
      <Row label="Lead">
        <bdi>{lead.name ?? "No name"}</bdi>
        {lead.phone && <span className="text-muted"> · {lead.phone}</span>}
        <p className="text-[13px] text-muted">
          {lead.language === "ar" ? "Arabic" : "English"} · {lead.status}
        </p>
      </Row>
      {view.needsHuman && (
        <Row label="Needs a person">
          <StatusMark tone="warn">The bot passed this lead to a person.</StatusMark>
        </Row>
      )}
      <Row label="Score">
        <StatusMark tone={scoreTone}>{scoreText}</StatusMark>
        {lead.scoreReasons.length > 0 && (
          <ul className="mt-1 list-disc pl-5 text-[13px] text-muted">
            {lead.scoreReasons.map((reason) => (
              <li key={reason}>
                <bdi>{reason}</bdi>
              </li>
            ))}
          </ul>
        )}
      </Row>
      <Row label="Answers">
        {rows.length === 0 ? (
          <span className="text-muted">Nothing yet</span>
        ) : (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
            {rows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-[13px] text-muted">{label}</dt>
                <dd>
                  <bdi>{value}</bdi>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </Row>
      {lead.summary && (
        <Row label="Summary">
          <p dir="auto">{lead.summary}</p>
        </Row>
      )}
      <Row label="Strikes">
        <span className="tabular-nums">
          {lead.strikes}
          {strikeLimit !== null && ` of ${strikeLimit}`}
        </span>
        {lead.aiStopped && (
          <p>
            <StatusMark tone="bad">AI stopped for this lead</StatusMark>
          </p>
        )}
      </Row>
      <Row label="AI tokens used">
        <span className="tabular-nums">{formatNumber(lead.tokensUsed)}</span>
      </Row>
      <Row label="Booking">
        {lead.booking ? (
          <StatusMark tone="ok">
            {lead.booking.kind === "call" ? "Call" : lead.booking.kind === "viewing" ? "Viewing" : lead.booking.kind}, {dateTime(lead.booking.startsAt)}
          </StatusMark>
        ) : (
          <span className="text-muted">None</span>
        )}
      </Row>
    </dl>
  );
}
