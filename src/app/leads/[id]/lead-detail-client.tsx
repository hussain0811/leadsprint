"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { flushSync } from "react-dom";
import { Button, Field, Input, NoticeLine, Section, Select, StatusMark, TextButton, type Notice } from "@/components/ui";
import { apiFetch } from "@/lib/api-client";
import type { OrgSettings } from "@/lib/chat/types";
import {
  answerRows,
  BOOKING_STATUS_LABEL,
  dubaiDateTime,
  KIND_LABEL,
  sourceLabel,
  statusLabel,
  STATUS_LABEL,
} from "@/lib/leads/present";
import { LEAD_STATUSES, type BookingView, type LeadDetail } from "@/lib/leads/types";
import { timeAgo } from "@/lib/time";
import { errorText, leadPath, LINK, Phone, ScoreMark, UserText } from "../shared";

const NUMBER = new Intl.NumberFormat("en-US");

type Busy = null | "save" | "handoff" | "close" | "delete" | `booking:${string}`;

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function LeadDetailRoute() {
  const params = useParams<{ id: string }>();
  const id = typeof params.id === "string" ? safeDecode(params.id) : "";
  return <LeadDetailClient key={id} id={id} />;
}

export function LeadDetailClient({ id }: { id: string }) {
  const router = useRouter();
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [loadError, setLoadError] = useState<{ text: string; missing: boolean } | null>(null);
  const [strikeLimit, setStrikeLimit] = useState<number | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [statusNotice, setStatusNotice] = useState<Notice>(null);
  // Kept here because a save remounts the edit form with the saved values.
  const [editNotice, setEditNotice] = useState<Notice>(null);
  // Set just before a save remounts the edit form, so the new form takes keyboard focus back.
  const refocusEdit = useRef(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(leadPath(id)).then(
      async (res) => {
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (res.ok) {
          setLead(body.lead);
          setLoadError(null);
        } else setLoadError({ text: body?.error ?? `The request failed (status ${res.status}).`, missing: res.status === 404 });
      },
      (err: unknown) => {
        if (!cancelled) setLoadError({ text: errorText(err), missing: false });
      },
    );
    // The strike limit is an extra: the page works without it.
    apiFetch<{ settings: OrgSettings }>("/api/settings").then(
      (res) => !cancelled && setStrikeLimit(res.settings?.strikeLimit ?? null),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [id, attempt]);

  const run = useCallback(async (kind: Exclude<Busy, null>, task: () => Promise<void>, onError: (text: string) => void) => {
    setBusy(kind);
    try {
      await task();
    } catch (err) {
      onError(errorText(err));
    } finally {
      flushSync(() => setBusy(null));
    }
  }, []);

  if (!lead) {
    if (!loadError) return <p className="mt-8 text-muted">Loading this lead…</p>;
    return (
      <div className="mt-8 grid justify-items-start gap-3">
        <p className="text-bad">{loadError.missing ? loadError.text : `Couldn't load this lead: ${loadError.text}`}</p>
        {loadError.missing ? (
          <Link href="/leads" className={LINK}>
            Go to the leads list
          </Link>
        ) : (
          <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
        )}
      </div>
    );
  }

  function setStatus(status: "handed_off" | "closed") {
    return run(
      status === "handed_off" ? "handoff" : "close",
      async () => {
        const res = await apiFetch<{ lead: LeadDetail }>(leadPath(id), { method: "PATCH", json: { status } });
        setLead(res.lead);
        setStatusNotice({
          tone: "ok",
          text: status === "handed_off" ? "Marked as with a person. The “needs a person” flag is cleared." : "Closed.",
        });
      },
      (text) => setStatusNotice({ tone: "bad", text }),
    );
  }

  return (
    <div>
      <Overview lead={lead} />

      <Section title="Answers" intro="What the lead told the bot, in their words where they typed them.">
        <dl className="grid gap-x-6 gap-y-2.5 text-[15px] sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
          {answerRows(lead.qualification).map((row) => (
            <div key={row.label} className="contents">
              <dt className="text-muted">{row.label}</dt>
              <dd className="mb-2 sm:mb-0">
                {row.value ? <bdi dir="auto">{row.value}</bdi> : <span className="text-muted">Not answered</span>}
              </dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="Score" intro="Worked out from the answers each time the lead replies.">
        <ScoreMark score={lead.score} />
        {lead.scoreReasons.length > 0 && (
          <ul className="mt-3 grid list-disc gap-1.5 pl-5 text-[15px] leading-relaxed">
            {lead.scoreReasons.map((r) => (
              <li key={r}>
                <bdi dir="auto">{r}</bdi>
              </li>
            ))}
          </ul>
        )}
        <h3 className="mt-6 text-[15px] font-medium">Summary</h3>
        {lead.summary ? (
          <p dir="auto" className="mt-1.5 max-w-[62ch] whitespace-pre-line text-[15px] leading-relaxed">
            {lead.summary}
          </p>
        ) : (
          <p className="mt-1.5 text-[15px] text-muted">No summary yet. The AI writes one once it has talked with the lead.</p>
        )}
      </Section>

      <Section title="Conversation" intro="How the chat went, and where to read or answer it.">
        <dl className="grid gap-x-6 gap-y-2.5 text-[15px] sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
          <dt className="text-muted">Needs a person</dt>
          <dd>{lead.needsPerson ? <StatusMark tone="warn">Needs a person</StatusMark> : "No"}</dd>
          <dt className="text-muted">Strikes</dt>
          <dd className="tabular-nums">
            {lead.strikes}
            {strikeLimit !== null && ` of ${strikeLimit}`}
            <span className="text-muted"> (for abuse or repeated off-topic messages)</span>
          </dd>
          <dt className="text-muted">Who answers</dt>
          <dd>
            <Answering lead={lead} />
          </dd>
          <dt className="text-muted">AI tokens used</dt>
          <dd className="tabular-nums">{NUMBER.format(lead.tokensUsed)}</dd>
          <dt className="text-muted">Language</dt>
          <dd>{lead.language === "ar" ? "Arabic" : "English"}</dd>
        </dl>
        {lead.conversations.length === 0 ? (
          <p className="mt-5 text-[15px] text-muted">No conversation yet.</p>
        ) : (
          <ul className="mt-5 grid gap-2 text-[15px]">
            {lead.conversations.map((c) => (
              <li key={c.id}>
                <Link href={`/inbox?c=${encodeURIComponent(c.id)}`} className={LINK}>
                  Open the conversation in the Inbox
                </Link>
                <span className="text-muted">
                  {" "}
                  · {c.messageCount} message{c.messageCount === 1 ? "" : "s"}, last {timeAgo(c.updatedAt)}
                  {c.humanTakeover && " · a person has taken over"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Bookings lead={lead} busy={busy} run={run} onChanged={setLead} />

      <EditLead key={`${lead.id}:${lead.name}:${lead.phone}:${lead.email}:${lead.status}`} lead={lead} busy={busy} run={run} onSaved={setLead} notice={editNotice} onNotice={setEditNotice} refocusRef={refocusEdit} />

      <Section title="Next step" intro="Mark what happened with this lead. You can change the status again at any time above.">
        <div className="flex flex-wrap gap-3">
          <Button
            variant="secondary"
            disabled={busy !== null || lead.status === "handed_off"}
            onClick={() => setStatus("handed_off")}
          >
            {busy === "handoff" ? "Saving…" : "Mark as handed to a person"}
          </Button>
          <Button variant="secondary" disabled={busy !== null || lead.status === "closed"} onClick={() => setStatus("closed")}>
            {busy === "close" ? "Saving…" : "Close lead"}
          </Button>
        </div>
        <NoticeLine notice={statusNotice} className="mt-3" />
      </Section>

      <DeleteLead lead={lead} busy={busy} run={run} onDeleted={() => router.push("/leads")} />
    </div>
  );
}

// Same rule as the Inbox: a person who took over, else the scripted flow when the AI can't answer, else the AI.
function Answering({ lead }: { lead: LeadDetail }) {
  if (lead.blocked) return <StatusMark tone="bad">Blocked: the bot no longer replies</StatusMark>;
  if (lead.answering === "person") return <StatusMark tone="warn">A person is answering</StatusMark>;
  if (lead.answering === "scripted")
    return (
      <StatusMark tone="muted">
        The scripted flow is answering{lead.answeringWhy && <span className="text-muted"> ({lead.answeringWhy})</span>}
      </StatusMark>
    );
  if (lead.answering === "ai") return <StatusMark tone="ok">The AI is answering</StatusMark>;
  return <span className="text-muted">No conversation yet</span>;
}

function Overview({ lead }: { lead: LeadDetail }) {
  return (
    <section aria-labelledby="lead-name" className="border-b border-line py-8">
      <h2 id="lead-name" className="text-[1.375rem] font-semibold leading-tight">
        <UserText>{lead.name}</UserText>
      </h2>
      <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3 text-[14px]">
        <Fact label="Phone">
          <Phone phone={lead.phone} />
        </Fact>
        <Fact label="Email">{lead.email ? <bdi dir="ltr">{lead.email}</bdi> : <span className="text-muted">None</span>}</Fact>
        <Fact label="Project">{lead.projectName ? <UserText>{lead.projectName}</UserText> : <span className="text-muted">None</span>}</Fact>
        <Fact label="Score">
          <ScoreMark score={lead.score} />
        </Fact>
        <Fact label="Status">{statusLabel(lead.status)}</Fact>
        <Fact label="Source">{sourceLabel(lead.source)}</Fact>
        <Fact label="First contact">
          <time dateTime={lead.createdAt}>{new Date(lead.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</time>
        </Fact>
        <Fact label="Last activity">
          <time dateTime={lead.lastActivityAt}>{timeAgo(lead.lastActivityAt)}</time>
        </Fact>
      </dl>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

type RunFn = (kind: Exclude<Busy, null>, task: () => Promise<void>, onError: (text: string) => void) => Promise<void>;

function Bookings({ lead, busy, run, onChanged }: { lead: LeadDetail; busy: Busy; run: RunFn; onChanged: (lead: LeadDetail) => void }) {
  const [notice, setNotice] = useState<Notice>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);

  function update(b: BookingView, status: "cancelled" | "done") {
    if (status === "cancelled" && !window.confirm(`Cancel the ${KIND_LABEL[b.kind]?.toLowerCase() ?? "booking"} on ${dubaiDateTime(b.startsAt)}? The time becomes free for other leads.`)) return;
    return run(
      `booking:${b.id}`,
      async () => {
        const res = await apiFetch<{ lead: LeadDetail }>(leadPath(lead.id, `/bookings/${encodeURIComponent(b.id)}`), {
          method: "PATCH",
          json: { status },
        });
        onChanged(res.lead);
        setNotice({ tone: "ok", text: status === "cancelled" ? "Cancelled. The time is free for other leads to book." : "Marked as done." });
        noticeRef.current?.focus();
      },
      (text) => setNotice({ tone: "bad", text }),
    );
  }

  return (
    <Section title="Bookings" intro="Viewings and calls this lead booked, in Dubai time. Tell the lead yourself if you cancel one.">
      {lead.bookings.length === 0 ? (
        <p className="text-[15px] text-muted">No bookings.</p>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {lead.bookings.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-[15px]">
              <div>
                <span className="font-medium">{KIND_LABEL[b.kind] ?? b.kind}</span> · {dubaiDateTime(b.startsAt)}
                {b.projectName && (
                  <>
                    {" "}
                    · <UserText>{b.projectName}</UserText>
                  </>
                )}
                <div className="mt-0.5">
                  <StatusMark tone={b.status === "booked" ? "ok" : "muted"}>{BOOKING_STATUS_LABEL[b.status] ?? b.status}</StatusMark>
                </div>
              </div>
              {b.status === "booked" && (
                <div className="flex gap-5">
                  <TextButton disabled={busy !== null} onClick={() => update(b, "done")}>
                    Mark done
                  </TextButton>
                  <TextButton tone="bad" disabled={busy !== null} onClick={() => update(b, "cancelled")}>
                    {busy === `booking:${b.id}` ? "Saving…" : "Cancel booking"}
                  </TextButton>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <p ref={noticeRef} tabIndex={-1} role="status" className={`mt-3 min-h-5 text-[14px] ${notice?.tone === "bad" ? "text-bad" : "text-ok"}`}>
        {notice?.text}
      </p>
    </Section>
  );
}

function EditLead({
  lead,
  busy,
  run,
  onSaved,
  notice,
  onNotice: setNotice,
  refocusRef,
}: {
  lead: LeadDetail;
  busy: Busy;
  run: RunFn;
  onSaved: (lead: LeadDetail) => void;
  notice: Notice;
  onNotice: (notice: Notice) => void;
  refocusRef: RefObject<boolean>;
}) {
  const statusRef = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (!refocusRef.current) return;
    refocusRef.current = false;
    statusRef.current?.focus();
  }, [refocusRef]);
  const uid = useId();
  const [name, setName] = useState(lead.name ?? "");
  const [phone, setPhone] = useState(lead.phone ?? "");
  const [email, setEmail] = useState(lead.email ?? "");
  const [status, setStatus] = useState(lead.status);
  const changed = name !== (lead.name ?? "") || phone !== (lead.phone ?? "") || email !== (lead.email ?? "") || status !== lead.status;

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!changed || busy) return;
    setNotice(null);
    return run(
      "save",
      async () => {
        const res = await apiFetch<{ lead: LeadDetail }>(leadPath(lead.id), {
          method: "PATCH",
          json: { name: name.trim(), phone: phone.trim(), email: email.trim(), status },
        });
        setNotice({ tone: "ok", text: "Saved." });
        refocusRef.current = true;
        onSaved(res.lead); // remounts this form with the saved values
      },
      (text) => setNotice({ tone: "bad", text }),
    );
  }

  return (
    <Section title="Contact and status" intro="Correct the lead's details. Leave a field empty to clear it.">
      <form onSubmit={save} className="grid max-w-xl gap-4">
        <Field label="Name" htmlFor={`${uid}-name`}>
          <Input id={`${uid}-name`} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} dir="auto" autoComplete="off" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone" htmlFor={`${uid}-phone`}>
            <Input
              id={`${uid}-phone`}
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={30}
              dir="ltr"
              autoComplete="off"
              placeholder="+971 50 123 4567"
            />
          </Field>
          <Field label="Email" htmlFor={`${uid}-email`}>
            <Input id={`${uid}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} dir="ltr" autoComplete="off" />
          </Field>
        </div>
        <Field label="Status" htmlFor={`${uid}-status`}>
          <Select ref={statusRef} id={`${uid}-status`} value={status} onChange={(e) => setStatus(e.target.value)}>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
            {!LEAD_STATUSES.includes(status as (typeof LEAD_STATUSES)[number]) && <option value={status}>{status}</option>}
          </Select>
        </Field>
        <div className="flex items-center gap-4">
          <Button type="submit" disabled={!changed || busy !== null}>
            {busy === "save" ? "Saving…" : "Save changes"}
          </Button>
        </div>
        <NoticeLine notice={notice} />
      </form>
    </Section>
  );
}

function DeleteLead({ lead, busy, run, onDeleted }: { lead: LeadDetail; busy: Busy; run: RunFn; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  function remove() {
    return run(
      "delete",
      async () => {
        await apiFetch(leadPath(lead.id), { method: "DELETE" });
        onDeleted();
      },
      (text) => setNotice({ tone: "bad", text }),
    );
  }

  return (
    <Section title="Delete lead" intro="Removes the lead, its conversation and its bookings for good. Booked times become free.">
      {confirming ? (
        <div role="group" aria-label="Confirm delete" className="grid justify-items-start gap-3">
          <p className="text-[15px]">
            Delete <UserText>{lead.name}</UserText> and everything with it? This can&apos;t be undone.
          </p>
          <div className="flex gap-3">
            <button
              ref={confirmRef}
              type="button"
              disabled={busy !== null}
              onClick={remove}
              className="inline-flex h-9 items-center rounded-[4px] bg-bad px-4 text-[14px] font-medium text-panel disabled:opacity-50"
            >
              {busy === "delete" ? "Deleting…" : "Delete for good"}
            </button>
            <Button
              variant="secondary"
              disabled={busy === "delete"}
              onClick={() => {
                flushSync(() => setConfirming(false));
                startRef.current?.focus();
              }}
            >
              Keep the lead
            </Button>
          </div>
        </div>
      ) : (
        <Button ref={startRef} variant="secondary" className="text-bad" disabled={busy !== null} onClick={() => setConfirming(true)}>
          Delete this lead
        </Button>
      )}
      <NoticeLine notice={notice} className="mt-3" />
    </Section>
  );
}
