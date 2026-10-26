"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, type Notice } from "@/components/ui";
import { apiFetch } from "@/lib/api-client";
import type { ConversationView } from "@/lib/chat/types";
import { filtersQuery } from "@/lib/inbox/filters";
import type { InboxResponse } from "@/lib/inbox/types";
import { conversationPath, errorText } from "../chat/format";
import { ConversationList, type FilterState } from "./conversation-list";
import { inboxThreadHref } from "./labels";
import { Thread, type ThreadBusy } from "./thread";

const POLL_MS = 5000;
const SEARCH_DELAY_MS = 300;

type ThreadState =
  | { status: "idle" }
  | { status: "loading"; id: string }
  | { status: "error"; id: string; message: string }
  | { status: "ready"; view: ConversationView };

export function InboxClient() {
  const params = useSearchParams();
  const selectedId = params.get("c") || null;

  // ?needs=1 (e.g. from the Dashboard) opens the inbox filtered to conversations that need a person.
  const [filters, setFilters] = useState<FilterState>(() => ({
    needsHuman: params.get("needs") === "1",
    takeover: false,
    projectId: "",
    search: "",
  }));

  // The inbox URL for a conversation (or none), keeping the needs filter in it.
  function inboxUrl(id: string | null, needs = filters.needsHuman) {
    const base = id ? inboxThreadHref(id) : "/inbox";
    return needs ? `${base}${id ? "&" : "?"}needs=1` : base;
  }

  function changeFilters(next: FilterState) {
    if (next.needsHuman !== filters.needsHuman) window.history.replaceState(null, "", inboxUrl(selectedId, next.needsHuman));
    setFilters(next);
  }
  const [search, setSearch] = useState(""); // the search text after typing pauses
  const [data, setData] = useState<InboxResponse | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState(false);
  const [thread, setThread] = useState<ThreadState>({ status: "idle" });
  const [busy, setBusy] = useState<ThreadBusy>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusThread = useRef(false);
  const returnFocusTo = useRef<string | null>(null);
  // Bumped by every change made here, so a refresh that started earlier can't undo it on screen.
  const epoch = useRef(0);

  const query = filtersQuery({ needsHuman: filters.needsHuman, takeover: filters.takeover, projectId: filters.projectId || null, q: search });

  useEffect(() => {
    const timer = setTimeout(() => setSearch(filters.search), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [filters.search]);

  // The filters the list should show now; a response for older filters is dropped when it arrives.
  const currentQuery = useRef(query);
  useEffect(() => {
    currentQuery.current = query;
  }, [query]);

  const loadList = useCallback(
    async (background: boolean) => {
      const started = epoch.current;
      try {
        const next = await apiFetch<InboxResponse>(`/api/inbox${query ? `?${query}` : ""}`);
        if (currentQuery.current !== query) return;
        if (epoch.current !== started && background) return;
        setData(next);
        setListError(null);
        setRefreshError(false);
      } catch (err) {
        if (currentQuery.current !== query) return;
        if (background) setRefreshError(true);
        else setListError(errorText(err));
      }
    },
    [query],
  );

  const loadThread = useCallback(async (id: string, background: boolean) => {
    const started = epoch.current;
    try {
      const view = await apiFetch<ConversationView>(conversationPath(id));
      if (background && epoch.current !== started) return;
      setThread((current) => {
        const currentId = current.status === "ready" ? current.view.id : current.status === "idle" ? null : current.id;
        return currentId === id ? { status: "ready", view } : current;
      });
    } catch (err) {
      if (background) return; // a missed refresh is retried on the next tick
      setThread((current) => (current.status === "loading" && current.id === id ? { status: "error", id, message: errorText(err) } : current));
    }
  }, []);

  // The list: on first load and whenever the filters change.
  useEffect(() => {
    void loadList(false);
  }, [loadList]);

  // The open thread: whenever ?c= changes (including the browser's back and forward buttons).
  useEffect(() => {
    setNotice(null);
    setBusy(null);
    if (!selectedId) {
      setThread({ status: "idle" });
      return;
    }
    setThread({ status: "loading", id: selectedId });
    void loadThread(selectedId, false);
  }, [selectedId, loadThread]);

  // Refresh both every few seconds while the tab is visible. Drafts and scroll positions live
  // outside the fetched data, so a refresh leaves them alone.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.hidden) return;
      void loadList(true);
      if (selectedId) void loadThread(selectedId, true);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [loadList, loadThread, selectedId]);

  // Move focus to the thread once it has loaded after a click in the list, and back to the list on "back".
  const readyId = thread.status === "ready" ? thread.view.id : null;
  useEffect(() => {
    if (readyId && focusThread.current) {
      focusThread.current = false;
      headingRef.current?.focus();
    }
  }, [readyId]);
  useEffect(() => {
    if (selectedId || !returnFocusTo.current) return;
    const id = returnFocusTo.current;
    returnFocusTo.current = null;
    document.querySelector<HTMLAnchorElement>(`a[data-conversation="${CSS.escape(id)}"]`)?.focus();
  }, [selectedId, data]);

  function open(id: string) {
    focusThread.current = true;
    if (id === selectedId) {
      headingRef.current?.focus();
      return;
    }
    window.history.pushState(null, "", inboxUrl(id));
  }

  function back() {
    returnFocusTo.current = selectedId;
    window.history.pushState(null, "", inboxUrl(null));
  }

  async function act(kind: Exclude<ThreadBusy, null>, task: () => Promise<ConversationView>, done: string): Promise<boolean> {
    if (thread.status !== "ready" || busy) return false;
    const id = thread.view.id;
    epoch.current += 1;
    setBusy(kind);
    setNotice(null);
    try {
      const view = await task();
      epoch.current += 1;
      setThread((current) => (current.status === "ready" && current.view.id === id ? { status: "ready", view } : current));
      setNotice({ tone: "ok", text: done });
      void loadList(false);
      return true;
    } catch (err) {
      setNotice({ tone: "bad", text: errorText(err) });
      return false;
    } finally {
      setBusy(null);
    }
  }

  const view = thread.status === "ready" ? thread.view : null;
  const item = view ? data?.items.find((i) => i.id === view.id) : undefined;

  function takeover(on: boolean) {
    if (!view) return;
    void act(
      "takeover",
      () => apiFetch<ConversationView>(conversationPath(view.id), { method: "PATCH", json: { humanTakeover: on } }),
      on ? "You've taken over. The bot stays quiet for this lead until you hand back." : "Handed back. The bot answers this lead again.",
    );
  }

  function handled() {
    if (!view) return;
    void act(
      "handled",
      () => apiFetch<ConversationView>(`/api/inbox/conversations/${encodeURIComponent(view.id)}`, { method: "PATCH", json: { needsHuman: false } }),
      "Marked as handled.",
    );
  }

  function reply(text: string) {
    if (!view) return Promise.resolve(false);
    return act(
      "reply",
      () => apiFetch<ConversationView>(conversationPath(view.id, "/agent-reply"), { method: "POST", json: { text } }),
      "Reply sent.",
    );
  }

  return (
    <div className="mt-6 lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start lg:gap-8">
      <div className={`${selectedId ? "hidden lg:flex" : "flex"} min-h-0 flex-col`}>
        <ConversationList
          data={data}
          error={listError}
          refreshError={refreshError}
          filters={filters}
          selectedId={selectedId}
          onFilters={changeFilters}
          onOpen={open}
          onRetry={() => void loadList(false)}
        />
      </div>

      <div className={`${selectedId ? "flex" : "hidden lg:flex"} min-h-0 flex-col lg:border-l lg:border-line lg:pl-8`}>
        {thread.status === "idle" && (
          <p className="m-auto max-w-[30ch] text-center text-[14px] text-muted">Choose a conversation to read it and reply.</p>
        )}
        {thread.status === "loading" && <p className="text-[14px] text-muted">Opening the conversation…</p>}
        {thread.status === "error" && (
          <div className="grid justify-items-start gap-3 text-[14px]">
            <p className="text-bad">Couldn&apos;t open this conversation: {thread.message}</p>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="secondary"
                onClick={() => {
                  setThread({ status: "loading", id: thread.id });
                  void loadThread(thread.id, false);
                }}
              >
                Try again
              </Button>
              <Button variant="secondary" onClick={back}>
                Back to all conversations
              </Button>
            </div>
          </div>
        )}
        {view && (
          <Thread
            view={view}
            answering={item?.answering ?? null}
            busy={busy}
            notice={notice}
            draft={drafts[view.id] ?? ""}
            headingRef={headingRef}
            onDraft={(text) => setDrafts((d) => ({ ...d, [view.id]: text }))}
            onTakeover={takeover}
            onHandled={handled}
            onReply={reply}
            onBack={back}
          />
        )}
      </div>
    </div>
  );
}
