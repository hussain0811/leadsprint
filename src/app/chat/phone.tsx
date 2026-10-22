"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { ConversationView, InboundInput, MessageView, OutgoingMessage, ReplyOption } from "@/lib/chat/types";
import { clockTime, useNow, windowState } from "./format";

const AUTHOR_LABEL: Record<MessageView["author"], string> = {
  lead: "Lead",
  bot: "Scripted bot",
  ai: "AI agent",
  agent: "Agent (person)",
  system: "System",
};

export type PendingMessage = { text: string; since: number };

// A phone-shaped chat that behaves like WhatsApp (buttons, list menus, documents, the 24-hour window),
// labelled as a simulation and without WhatsApp's name or branding.
export function Phone({
  view,
  pending,
  elapsed,
  busy,
  onSend,
}: {
  view: ConversationView;
  pending: PendingMessage | null; // the lead's message while the bot's turn runs
  elapsed: number; // seconds since it was sent
  busy: boolean; // a request is running: taps and sends wait
  onSend: (input: InboundInput, shownAs: string) => void;
}) {
  const now = useNow();
  const logRef = useRef<HTMLOListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [openList, setOpenList] = useState<{ message: MessageView; trigger: HTMLButtonElement } | null>(null);
  const window24 = windowState(view, now);
  const business = view.lead.projectName ?? "Your business";

  // Keep the newest message in view, like a real chat.
  const lastId = view.messages[view.messages.length - 1]?.id;
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [lastId, pending]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    onSend({ text }, text);
    setDraft("");
  }

  function tap(option: ReplyOption) {
    if (busy) return;
    onSend({ replyId: option.id }, option.title);
    // The tapped button is disabled while the bot replies; keep keyboard focus in the chat.
    inputRef.current?.focus();
  }

  function closeList(chosen?: ReplyOption) {
    const trigger = openList?.trigger;
    setOpenList(null);
    if (chosen) {
      tap(chosen);
      inputRef.current?.focus();
    } else {
      trigger?.focus();
    }
  }

  return (
    <div className="mx-auto w-full max-w-[22rem] rounded-[2.25rem] border border-line bg-board p-2.5 shadow-sm">
      <div className="relative flex h-[38rem] flex-col overflow-clip rounded-[1.75rem] bg-glass">
        {/* Header: what the lead sees at the top of the chat. */}
        <div className="bg-marina px-4 pb-2.5 pt-3 text-on-marina">
          <div className="flex items-center gap-3">
            <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-on-marina/15 text-[15px] font-semibold">
              {business.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-medium" dir="auto">
                {business}
              </p>
              <p className="text-[12px] opacity-80">Automated assistant</p>
            </div>
            <span className="rounded-[3px] border border-on-marina/40 px-1.5 py-0.5 text-[11px] uppercase tracking-wide">Simulation</span>
          </div>
        </div>
        <p
          className={`flex items-start gap-2 border-b border-line px-4 py-1.5 text-[12px] leading-snug ${
            window24.open ? "bg-panel text-muted" : "bg-panel text-warn"
          }`}
        >
          <span aria-hidden className={`mt-[0.3125rem] size-1.5 shrink-0 rounded-full ${window24.open ? "bg-ok" : "bg-warn"}`} />
          {window24.text}
        </p>

        <ol
          ref={logRef}
          role="log"
          aria-label="Messages"
          aria-live="polite"
          aria-relevant="additions"
          className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 py-3"
        >
          {view.messages.length === 0 && !pending && (
            <li className="m-auto max-w-[16rem] text-center text-[13px] text-muted">No messages yet. Write as the lead to start.</li>
          )}
          {view.messages.map((message) => (
            <Bubble
              key={message.id}
              message={message}
              busy={busy}
              onTap={tap}
              onOpenList={(trigger) => setOpenList({ message, trigger })}
            />
          ))}
          {pending && (
            <li className="flex flex-col items-end">
              <div className="max-w-[85%] rounded-[10px] rounded-tr-[3px] bg-marina/15 px-3 py-2 text-[14px] leading-relaxed text-ink opacity-80">
                <p dir="auto" className="whitespace-pre-wrap break-words">
                  {pending.text}
                </p>
                <p className="mt-0.5 text-right text-[11px] text-muted">Sending…</p>
              </div>
            </li>
          )}
          {pending && (
            <li className="flex">
              <div className="inline-flex items-center gap-2 rounded-[10px] rounded-tl-[3px] bg-panel px-3 py-2 text-[13px] text-muted">
                <span aria-hidden className="flex gap-1">
                  <span className="size-1.5 animate-pulse rounded-full bg-muted" />
                  <span className="size-1.5 animate-pulse rounded-full bg-muted [animation-delay:150ms]" />
                  <span className="size-1.5 animate-pulse rounded-full bg-muted [animation-delay:300ms]" />
                </span>
                <span>typing…</span>
                <span aria-hidden className="tabular-nums">{elapsed} s</span>
              </div>
            </li>
          )}
        </ol>

        <form onSubmit={submit} className="flex items-center gap-2 border-t border-line bg-panel px-2.5 py-2">
          <label htmlFor="phone-message" className="sr-only">
            Message as the lead
          </label>
          <input
            ref={inputRef}
            id="phone-message"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Message"
            dir="auto"
            autoComplete="off"
            className="h-10 min-w-0 flex-1 rounded-full border border-line bg-glass px-4 text-[14px] text-ink placeholder:text-muted focus:border-marina"
          />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            aria-label="Send"
            className="grid size-10 shrink-0 place-items-center rounded-full bg-marina text-on-marina hover:bg-marina-strong disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg aria-hidden viewBox="0 0 24 24" className="size-[18px]" fill="currentColor">
              <path d="M3.4 20.4 21 12 3.4 3.6l-.01 6.53L15 12 3.39 13.87z" />
            </svg>
          </button>
        </form>

        {openList && openList.message.message.kind === "list" && (
          <ListSheet message={openList.message.message} busy={busy} onClose={closeList} />
        )}
      </div>
    </div>
  );
}

function Bubble({
  message,
  busy,
  onTap,
  onOpenList,
}: {
  message: MessageView;
  busy: boolean;
  onTap: (option: ReplyOption) => void;
  onOpenList: (trigger: HTMLButtonElement) => void;
}) {
  const m = message.message;
  const time = clockTime(message.createdAt);

  // Notes are for the admin only: the lead never sees them.
  if (m.kind === "note" || message.author === "system") {
    return (
      <li className="my-1 self-center">
        <p className="max-w-[17rem] rounded-[6px] bg-brass/15 px-3 py-1.5 text-center text-[12px] leading-snug text-ink">
          <span className="font-medium">Only you see this: </span>
          <bdi>{m.body}</bdi>
        </p>
      </li>
    );
  }

  const fromLead = message.direction === "in";
  return (
    <li className={`flex flex-col ${fromLead ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-[85%] rounded-[10px] px-3 py-2 text-[14px] leading-relaxed text-ink shadow-[0_1px_0_rgb(0_0_0/0.06)] ${
          fromLead ? "rounded-tr-[3px] bg-marina/15" : "rounded-tl-[3px] bg-panel"
        }`}
      >
        {!fromLead && <p className={`mb-0.5 text-[11px] font-medium ${message.author === "agent" ? "text-brass" : "text-marina"}`}>{AUTHOR_LABEL[message.author]}</p>}
        {m.kind === "document" && <DocumentCard doc={m.document} />}
        {m.body && (
          <p dir="auto" className="whitespace-pre-wrap break-words">
            {m.body}
          </p>
        )}
        <p className="mt-0.5 text-right text-[11px] text-muted">
          <span className="sr-only">{fromLead ? "Sent" : "Received"} at </span>
          {time}
        </p>
      </div>
      <Options message={m} busy={busy} onTap={onTap} onOpenList={onOpenList} />
    </li>
  );
}

function Options({
  message,
  busy,
  onTap,
  onOpenList,
}: {
  message: OutgoingMessage;
  busy: boolean;
  onTap: (option: ReplyOption) => void;
  onOpenList: (trigger: HTMLButtonElement) => void;
}) {
  const tapClass =
    "w-full rounded-[10px] bg-panel px-3 py-2 text-center text-[14px] font-medium text-marina shadow-[0_1px_0_rgb(0_0_0/0.06)] hover:bg-panel/70 disabled:cursor-not-allowed disabled:opacity-60";
  if (message.kind === "buttons") {
    return (
      <div className="mt-1 grid w-[85%] gap-1" role="group" aria-label="Reply buttons">
        {message.buttons.map((button) => (
          <button key={button.id} type="button" disabled={busy} onClick={() => onTap(button)} className={tapClass} dir="auto">
            {button.title}
          </button>
        ))}
      </div>
    );
  }
  if (message.kind === "list") {
    return (
      <div className="mt-1 w-[85%]">
        <button
          type="button"
          disabled={busy}
          aria-haspopup="dialog"
          onClick={(e) => onOpenList(e.currentTarget)}
          className={`${tapClass} inline-flex items-center justify-center gap-2`}
        >
          <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="currentColor">
            <path d="M4 6h2v2H4zm4 0h12v2H8zM4 11h2v2H4zm4 0h12v2H8zm-4 5h2v2H4zm4 0h12v2H8z" />
          </svg>
          <span dir="auto">{message.buttonLabel}</span>
        </button>
      </div>
    );
  }
  return null;
}

function DocumentCard({ doc }: { doc: { sourceId: string; title: string; fileName: string | null } }) {
  return (
    <a
      href={`/api/knowledge/sources/${encodeURIComponent(doc.sourceId)}/file`}
      target="_blank"
      rel="noreferrer"
      className="mb-1.5 flex items-center gap-2.5 rounded-[6px] bg-glass px-2.5 py-2 hover:bg-line/50"
    >
      <span aria-hidden className="grid h-9 w-7 shrink-0 place-items-center rounded-[3px] bg-bad text-[9px] font-semibold text-panel">
        {(doc.fileName?.split(".").pop() ?? "DOC").slice(0, 4).toUpperCase()}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium" dir="auto">
          {doc.title}
        </span>
        <span className="block truncate text-[11px] text-muted">
          {doc.fileName ?? "Document"} <span className="sr-only">(opens in a new tab)</span>
        </span>
      </span>
    </a>
  );
}

// The sheet a list message opens: one choice per row, like WhatsApp's list picker.
function ListSheet({
  message,
  busy,
  onClose,
}: {
  message: Extract<OutgoingMessage, { kind: "list" }>;
  busy: boolean;
  onClose: (chosen?: ReplyOption) => void;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    sheetRef.current?.querySelector<HTMLButtonElement>("button[data-row]")?.focus();
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    // Keep Tab inside the sheet while it's open.
    if (event.key === "Tab") {
      const buttons = Array.from(sheetRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
      if (buttons.length === 0) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  return (
    <div className="absolute inset-0 z-10 flex flex-col justify-end">
      <button type="button" tabIndex={-1} aria-hidden className="absolute inset-0 bg-black/35" onClick={() => onClose()} />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={message.buttonLabel}
        onKeyDown={onKeyDown}
        className="relative max-h-[75%] overflow-y-auto rounded-t-[1.25rem] bg-panel pb-2"
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <button type="button" onClick={() => onClose()} className="rounded-[3px] px-1 text-[20px] leading-none text-muted" aria-label="Close">
            ×
          </button>
          <p className="flex-1 text-center text-[15px] font-medium" dir="auto">
            {message.buttonLabel}
          </p>
          <span className="w-5" />
        </div>
        <ul className="divide-y divide-line">
          {message.rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                data-row
                disabled={busy}
                onClick={() => onClose(row)}
                dir="auto"
                className="flex w-full items-center gap-3 px-4 py-3 text-start hover:bg-glass disabled:opacity-60"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px]">{row.title}</span>
                  {row.description && <span className="block text-[12px] text-muted">{row.description}</span>}
                </span>
                <span aria-hidden className="size-4 shrink-0 rounded-full border-2 border-muted" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
