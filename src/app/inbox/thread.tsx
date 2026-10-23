"use client";

import Link from "next/link";
import { useId, useLayoutEffect, useRef, type FormEvent, type RefObject } from "react";
import { Button, NoticeLine, StatusMark, Textarea, type Notice } from "@/components/ui";
import type { ConversationView, MessageView } from "@/lib/chat/types";
import { answeringMode } from "@/lib/inbox/filters";
import type { Answering } from "@/lib/inbox/types";
import { clockTime, dateTime } from "../chat/format";
import { ANSWERING_LABEL, SCORE_LABEL, authorLabel } from "./labels";

export type ThreadBusy = null | "takeover" | "handled" | "reply";

// Within this many pixels of the bottom counts as "reading the newest messages".
const STICK_PX = 48;

export function Thread({
  view,
  answering,
  busy,
  notice,
  draft,
  headingRef,
  onDraft,
  onTakeover,
  onHandled,
  onReply,
  onBack,
}: {
  view: ConversationView;
  answering: Answering | null; // from the list, which knows whether the AI connection is ready
  busy: ThreadBusy;
  notice: Notice;
  draft: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onDraft: (text: string) => void;
  onTakeover: (on: boolean) => void;
  onHandled: () => void;
  onReply: (text: string) => Promise<boolean>;
  onBack: () => void;
}) {
  const headingId = useId();
  const lead = view.lead;
  const [scoreTone, scoreText] = SCORE_LABEL[lead.score];
  // The thread itself knows takeover and the scripted switches; the list also knows whether the AI connection is ready.
  const fromThread = answeringMode({ humanTakeover: view.humanTakeover, forceScripted: view.forceScripted, aiStopped: lead.aiStopped, aiReady: true });
  const who: Answering = fromThread === "ai" && answering === "scripted" ? "scripted" : fromThread;

  return (
    <section aria-labelledby={headingId} className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-line pb-4">
        <button
          type="button"
          onClick={onBack}
          className="mb-3 inline-flex min-h-6 items-center gap-1 rounded-[2px] text-[14px] font-medium text-marina underline-offset-4 hover:underline lg:hidden"
        >
          <span aria-hidden>←</span> All conversations
        </button>
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold leading-snug">
              <bdi>{lead.name || lead.phone || "No name"}</bdi>
            </h2>
            <p className="mt-0.5 text-[14px] text-muted">
              {lead.projectName ? <bdi>{lead.projectName}</bdi> : "No project"}
              {lead.phone && (
                <>
                  {" · "}
                  <span dir="ltr">{lead.phone}</span>
                </>
              )}
              {" · "}
              {lead.language === "ar" ? "Arabic" : "English"}
            </p>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
              <StatusMark tone={scoreTone}>
                <span className="sr-only">Score: </span>
                {scoreText}
              </StatusMark>
              <StatusMark tone={who === "person" ? "warn" : who === "ai" ? "ok" : "muted"}>{ANSWERING_LABEL[who]}</StatusMark>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <Button variant={view.humanTakeover ? "secondary" : "primary"} disabled={busy !== null} onClick={() => onTakeover(!view.humanTakeover)}>
              {busy === "takeover" ? "Saving…" : view.humanTakeover ? "Hand back to the bot" : "Take over"}
            </Button>
            <Link href={`/leads/${encodeURIComponent(lead.id)}`} className="rounded-[2px] text-[14px] font-medium text-marina underline-offset-4 hover:underline">
              Open lead
            </Link>
          </div>
        </div>

        {view.needsHuman && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-l-2 border-brass bg-brass/10 px-3 py-2">
            <p className="text-[14px]">
              <span className="font-semibold text-brass">Needs a person.</span> The bot handed this lead over or couldn&apos;t help.
            </p>
            <Button variant="secondary" disabled={busy !== null} onClick={onHandled}>
              {busy === "handled" ? "Saving…" : "Mark as handled"}
            </Button>
          </div>
        )}
        <NoticeLine notice={notice} className="mt-2" />
      </div>

      <Transcript view={view} />

      {view.humanTakeover ? (
        <ReplyBox key={view.id} draft={draft} busy={busy} onDraft={onDraft} onReply={onReply} />
      ) : (
        <p className="border-t border-line pt-3 text-[14px] text-muted">
          The bot is answering this lead. Take over to reply as a person; the bot pauses until you hand back.
        </p>
      )}
    </section>
  );
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function Transcript({ view }: { view: ConversationView }) {
  const ref = useRef<HTMLOListElement>(null);
  const atBottom = useRef(true);
  const shownId = useRef<string | null>(null);
  const count = view.messages.length;

  // Open at the newest message; on refresh, follow new messages only if the reader was already at the bottom.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (shownId.current !== view.id) {
      shownId.current = view.id;
      el.scrollTop = el.scrollHeight;
      atBottom.current = true;
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [view.id, count]);

  return (
    <ol
      ref={ref}
      role="log"
      aria-label="Messages"
      aria-live="polite"
      aria-relevant="additions"
      tabIndex={0}
      onScroll={(e) => {
        const el = e.currentTarget;
        atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
      }}
      className="my-3 grid max-h-[60vh] min-h-[12rem] flex-1 content-start gap-3 overflow-y-auto rounded-[4px] py-1 pr-1 lg:max-h-none"
    >
      {count === 0 && <li className="py-6 text-center text-[14px] text-muted">No messages yet.</li>}
      {view.messages.map((m, i) => {
        const day = dayLabel(m.createdAt);
        const separator = i === 0 || dayLabel(view.messages[i - 1].createdAt) !== day;
        return <MessageItem key={m.id} message={m} leadName={view.lead.name} day={separator ? day : null} />;
      })}
    </ol>
  );
}

const BORDER: Record<MessageView["author"], string> = {
  lead: "border-marina bg-marina/[0.07]",
  bot: "border-line bg-panel",
  ai: "border-line bg-panel",
  agent: "border-brass bg-panel",
  system: "border-line",
};

function MessageItem({ message, leadName, day }: { message: MessageView; leadName: string | null; day: string | null }) {
  const m = message.message;
  const time = (
    <time dateTime={message.createdAt} title={dateTime(message.createdAt)} className="text-[12px] text-muted">
      {clockTime(message.createdAt)}
    </time>
  );
  const separator = day && (
    <p className="mb-2 flex items-center gap-3 text-[12px] font-medium text-muted">
      <span aria-hidden className="h-px flex-1 bg-line" />
      {day}
      <span aria-hidden className="h-px flex-1 bg-line" />
    </p>
  );

  if (m.kind === "note" || message.author === "system") {
    return (
      <li>
        {separator}
        <p className="mx-auto max-w-[36rem] rounded-[4px] bg-brass/10 px-3 py-1.5 text-center text-[13px] leading-snug">
          <span className="font-medium">Note for your team: </span>
          <bdi>{m.body}</bdi> <span className="text-muted">· {clockTime(message.createdAt)}</span>
        </p>
      </li>
    );
  }

  return (
    <li>
      {separator}
      <div className={`border-l-[3px] px-3 py-2 ${BORDER[message.author]} ${message.direction === "in" ? "mr-6 sm:mr-16" : "ml-6 sm:ml-16"}`}>
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className={`text-[13px] font-semibold ${message.author === "agent" ? "text-brass" : message.author === "lead" ? "text-marina" : ""}`}>
            <bdi>{authorLabel(message.author, leadName)}</bdi>
          </span>
          {time}
        </p>
        {m.kind === "document" && (
          <p className="mt-1 text-[14px]">
            <a
              href={`/api/knowledge/sources/${encodeURIComponent(m.document.sourceId)}/file`}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-marina underline underline-offset-4"
            >
              <bdi>{m.document.title}</bdi>
              <span className="sr-only"> (document, opens in a new tab)</span>
            </a>
          </p>
        )}
        {m.body && (
          <p dir="auto" className="mt-0.5 text-[14px] leading-relaxed whitespace-pre-wrap break-words">
            {m.body}
          </p>
        )}
        {(m.kind === "buttons" || m.kind === "list") && (
          <div className="mt-1.5 text-[12px] text-muted">
            <span>{m.kind === "list" ? `Menu "${m.buttonLabel}" offered: ` : "Buttons offered: "}</span>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {(m.kind === "buttons" ? m.buttons : m.rows).map((o) => (
                <li key={o.id} dir="auto" className="rounded-[3px] border border-line px-1.5 py-0.5 text-[12px] text-ink">
                  {o.title}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </li>
  );
}

function ReplyBox({
  draft,
  busy,
  onDraft,
  onReply,
}: {
  draft: string;
  busy: ThreadBusy;
  onDraft: (text: string) => void;
  onReply: (text: string) => Promise<boolean>;
}) {
  const uid = useId();
  const ref = useRef<HTMLTextAreaElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || busy) return;
    const ok = await onReply(body);
    if (ok) onDraft("");
    ref.current?.focus();
  }

  return (
    <form onSubmit={submit} className="grid gap-2 border-t border-line pt-3">
      <label htmlFor={`${uid}-reply`} className="text-[14px] font-medium">
        Reply as a person
      </label>
      <Textarea
        id={`${uid}-reply`}
        ref={ref}
        rows={3}
        value={draft}
        dir="auto"
        maxLength={4096}
        aria-describedby={`${uid}-hint`}
        onChange={(e) => onDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy !== null || !draft.trim()}>
          {busy === "reply" ? "Sending…" : "Send reply"}
        </Button>
        <span id={`${uid}-hint`} className="text-[13px] text-muted">
          Ctrl+Enter sends. The lead sees it as a message from your team.
        </span>
      </div>
    </form>
  );
}
