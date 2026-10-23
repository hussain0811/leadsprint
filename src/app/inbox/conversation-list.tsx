"use client";

import { useId, type MouseEvent } from "react";
import { Button, Input, Select } from "@/components/ui";
import type { InboxItem, InboxResponse } from "@/lib/inbox/types";
import { timeAgo } from "@/lib/time";
import { useNow } from "../chat/format";
import { ANSWERING_SHORT, SCORE_LABEL, authorLabel, inboxThreadHref } from "./labels";

export type FilterState = { needsHuman: boolean; takeover: boolean; projectId: string; search: string };

const CHECK = "size-4 shrink-0 accent-[var(--marina)]";
const DOT = { ok: "bg-ok", warn: "bg-warn", bad: "bg-bad", muted: "bg-muted/50" } as const;

export function ConversationList({
  data,
  error,
  refreshError,
  filters,
  selectedId,
  onFilters,
  onOpen,
  onRetry,
}: {
  data: InboxResponse | null;
  error: string | null; // first load failed
  refreshError: boolean; // a later refresh failed; the list shown may be stale
  filters: FilterState;
  selectedId: string | null;
  onFilters: (next: FilterState) => void;
  onOpen: (id: string) => void;
  onRetry: () => void;
}) {
  const uid = useId();
  const now = useNow(15_000);
  const filtered = filters.needsHuman || filters.takeover || filters.projectId !== "" || filters.search.trim() !== "";
  const set = (patch: Partial<FilterState>) => onFilters({ ...filters, ...patch });

  return (
    <div className="flex min-h-0 flex-col">
      <form role="search" aria-label="Filter conversations" onSubmit={(e) => e.preventDefault()} className="grid gap-3 border-b border-line pb-4">
        <div>
          <label htmlFor={`${uid}-q`} className="sr-only">
            Search by name, phone or message
          </label>
          <Input
            id={`${uid}-q`}
            type="search"
            value={filters.search}
            onChange={(e) => set({ search: e.target.value })}
            placeholder="Search name, phone or message"
            dir="auto"
            maxLength={100}
            autoComplete="off"
          />
        </div>
        <div>
          <label htmlFor={`${uid}-project`} className="sr-only">
            Project
          </label>
          <Select id={`${uid}-project`} value={filters.projectId} onChange={(e) => set({ projectId: e.target.value })}>
            <option value="">All projects</option>
            <option value="none">No project</option>
            {data?.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <fieldset className="flex flex-wrap gap-x-5 gap-y-2 text-[14px]">
          <legend className="sr-only">Show only</legend>
          <label className="inline-flex min-h-6 items-center gap-2">
            <input type="checkbox" className={CHECK} checked={filters.needsHuman} onChange={(e) => set({ needsHuman: e.target.checked })} />
            Needs a person
            {data && <span className="tabular-nums text-muted">({data.counts.needsHuman})</span>}
          </label>
          <label className="inline-flex min-h-6 items-center gap-2">
            <input type="checkbox" className={CHECK} checked={filters.takeover} onChange={(e) => set({ takeover: e.target.checked })} />
            Taken over
            {data && <span className="tabular-nums text-muted">({data.counts.takeover})</span>}
          </label>
        </fieldset>
        {filtered && (
          <div>
            <button
              type="button"
              onClick={() => onFilters({ needsHuman: false, takeover: false, projectId: "", search: "" })}
              className="rounded-[2px] text-[13px] font-medium text-marina underline-offset-4 hover:underline"
            >
              Clear filters
            </button>
          </div>
        )}
      </form>

      {refreshError && data && <p className="pt-2 text-[13px] text-warn">Couldn&apos;t refresh. Trying again in a few seconds.</p>}

      {!data && error && (
        <div className="grid justify-items-start gap-3 py-4 text-[14px]">
          <p className="text-bad">Couldn&apos;t load conversations: {error}</p>
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
      {!data && !error && <p className="py-4 text-[14px] text-muted">Loading conversations…</p>}

      {data && (
        <>
          <p className="pt-3 pb-1 text-[13px] text-muted">
            {data.items.length === 0
              ? filtered
                ? "No conversations match these filters."
                : "No conversations yet. They appear here when leads write in, or when you start one in the Chat tester."
              : `${data.items.length} conversation${data.items.length === 1 ? "" : "s"}${data.items.length >= 200 ? " (newest 200)" : ""}`}
          </p>
          {data.items.length > 0 && (
            <ul aria-label="Conversations" className="min-h-0 flex-1 divide-y divide-line overflow-y-auto border-y border-line lg:-mx-1 lg:px-1">
              {data.items.map((item) => (
                <Row key={item.id} item={item} current={item.id === selectedId} now={now} onOpen={onOpen} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function Row({ item, current, now, onOpen }: { item: InboxItem; current: boolean; now: number; onOpen: (id: string) => void }) {
  const [scoreTone, scoreText] = SCORE_LABEL[item.score];
  const name = item.leadName || item.leadPhone || "No name";

  function click(event: MouseEvent<HTMLAnchorElement>) {
    // Let Ctrl/Cmd/Shift-click open a new tab as usual.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onOpen(item.id);
  }

  return (
    <li>
      <a
        href={inboxThreadHref(item.id)}
        onClick={click}
        aria-current={current ? "page" : undefined}
        data-conversation={item.id}
        className={`grid gap-1 border-l-[3px] py-3 pr-2 pl-3 hover:bg-panel ${
          current ? "border-marina bg-panel" : item.needsHuman ? "border-brass" : "border-transparent"
        }`}
      >
        <span className="flex items-baseline justify-between gap-3">
          <span className={`min-w-0 truncate text-[15px] ${item.needsHuman ? "font-semibold" : "font-medium"} ${current ? "text-marina" : ""}`}>
            <bdi>{name}</bdi>
          </span>
          <time dateTime={item.lastActivityAt} className="shrink-0 text-[12px] text-muted">
            {timeAgo(item.lastActivityAt, now)}
          </time>
        </span>
        <span className="truncate text-[13px] text-muted">{item.projectName ? <bdi>{item.projectName}</bdi> : "No project"}</span>
        <span dir="auto" className={`truncate text-[13px] ${item.needsHuman ? "text-ink" : "text-muted"}`}>
          {item.lastMessage ? (
            <>
              <span className="sr-only">{authorLabel(item.lastAuthor, item.leadName)}: </span>
              {item.lastMessage}
            </>
          ) : (
            "No messages yet"
          )}
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
          {item.needsHuman && (
            <span className="inline-flex items-center gap-1.5 font-semibold text-brass">
              <span aria-hidden className="size-2 rounded-full bg-brass" />
              Needs a person
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className={`size-2 rounded-full ${DOT[scoreTone]}`} />
            <span className="sr-only">Score: </span>
            {scoreText}
          </span>
          <span>
            <span className="sr-only">Answering: </span>
            {ANSWERING_SHORT[item.answering]}
          </span>
        </span>
      </a>
    </li>
  );
}
