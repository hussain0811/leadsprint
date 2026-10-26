"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type RefObject } from "react";
import { Button, Field, Input, NoticeLine, Section, Select, Switch, Textarea, type Notice } from "@/components/ui";
import { apiFetch } from "@/lib/api-client";
import type {
  ConversationSummary,
  ConversationView,
  InboundInput,
  Lang,
  OrgSettings,
  StartConversationRequest,
} from "@/lib/chat/types";
import type { ProjectOption } from "@/lib/knowledge/types";
import { timeAgo } from "@/lib/time";
import { conversationPath, errorText, useElapsed } from "./format";
import { Phone, type PendingMessage } from "./phone";
import { LeadPanel, TurnPanel } from "./turn-panel";

// While a person has taken over, check for new messages this often (another tab may be replying too).
const TAKEOVER_POLL_MS = 2000;

type Busy = null | "start" | "open" | "send" | "scripted" | "takeover" | "agent" | "delete";

export function ChatClient() {
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [strikeLimit, setStrikeLimit] = useState<number | null>(null);
  const [view, setView] = useState<ConversationView | null>(null);
  const [pending, setPending] = useState<PendingMessage | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const elapsed = useElapsed(pending?.since ?? null);
  const nameRef = useRef<HTMLInputElement>(null);
  const viewId = view?.id ?? null;

  const loadList = useCallback(() => {
    apiFetch<{ conversations: ConversationSummary[] }>("/api/chat/conversations").then(
      (res) => {
        setConversations(res.conversations);
        setListError(null);
      },
      (err: unknown) => setListError(errorText(err)),
    );
  }, []);

  useEffect(() => {
    loadList();
    // Projects and the strike limit are extras: the tester works without them.
    apiFetch<{ projects: ProjectOption[] }>("/api/knowledge").then(
      (res) => setProjects(res.projects ?? []),
      () => setProjects([]),
    );
    apiFetch<{ settings: OrgSettings }>("/api/settings").then(
      (res) => setStrikeLimit(res.settings?.strikeLimit ?? null),
      () => setStrikeLimit(null),
    );
  }, [loadList]);

  // Poll only while a person has taken over and nothing else is running.
  const polling = view?.humanTakeover === true && busy === null;
  useEffect(() => {
    if (!polling || !viewId) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      apiFetch<ConversationView>(conversationPath(viewId)).then(
        (next) => {
          if (!cancelled) setView((current) => (current?.id === next.id ? next : current));
        },
        () => {
          // A missed poll is retried on the next tick.
          if (!cancelled) setView((current) => (current ? { ...current } : current));
        },
      );
    }, TAKEOVER_POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [polling, viewId, view]);

  async function run(kind: Exclude<Busy, null>, task: () => Promise<void>) {
    setBusy(kind);
    setNotice(null);
    try {
      await task();
    } catch (err) {
      setNotice({ tone: "bad", text: errorText(err) });
    } finally {
      setBusy(null);
    }
  }

  function start(request: StartConversationRequest) {
    return run("start", async () => {
      const next = await apiFetch<ConversationView>("/api/chat/conversations", { method: "POST", json: request });
      setView(next);
      setNotice({ tone: "ok", text: "Started. Write as the lead in the phone below." });
      loadList();
      requestAnimationFrame(() => document.getElementById("phone-message")?.focus());
    });
  }

  function open(id: string) {
    return run("open", async () => {
      const next = await apiFetch<ConversationView>(conversationPath(id));
      setView(next);
    });
  }

  async function send(input: InboundInput, shownAs: string) {
    if (!view || busy) return;
    const id = view.id;
    setPending({ text: shownAs, since: Date.now() });
    setBusy("send");
    setNotice({ tone: "muted", text: "Sent. Waiting for the bot's reply…" });
    try {
      const next = await apiFetch<ConversationView>(conversationPath(id, "/messages"), { method: "POST", json: input });
      setView((current) => (current?.id === id ? next : current));
      setNotice(null);
      loadList();
    } catch (err) {
      setNotice({ tone: "bad", text: `Not sent: ${errorText(err)}` });
    } finally {
      setPending(null);
      setBusy(null);
    }
  }

  function patch(kind: "scripted" | "takeover", body: { forceScripted?: boolean; humanTakeover?: boolean }) {
    if (!view) return;
    const id = view.id;
    return run(kind, async () => {
      const next = await apiFetch<ConversationView>(conversationPath(id), { method: "PATCH", json: body });
      setView(next);
      if (body.forceScripted !== undefined) {
        setNotice({ tone: "ok", text: body.forceScripted ? "Scripted only: the AI won't answer this lead." : "The AI may answer again." });
      } else {
        setNotice({
          tone: "ok",
          text: body.humanTakeover ? "A person is answering. The bot stays quiet until you hand back." : "Handed back to the bot.",
        });
      }
    });
  }

  function agentReply(text: string) {
    if (!view) return Promise.resolve(false);
    const id = view.id;
    let ok = false;
    return run("agent", async () => {
      const next = await apiFetch<ConversationView>(conversationPath(id, "/agent-reply"), { method: "POST", json: { text } });
      setView(next);
      ok = true;
      setNotice({ tone: "ok", text: "Sent as a person." });
    }).then(() => ok);
  }

  function remove() {
    if (!view) return;
    if (!window.confirm("Delete this test conversation and its test lead? This can't be undone.")) return;
    const id = view.id;
    return run("delete", async () => {
      await apiFetch(conversationPath(id), { method: "DELETE" });
      setView(null);
      setConversations((list) => list?.filter((c) => c.id !== id) ?? list);
      setNotice({ tone: "ok", text: "Deleted the test conversation and its lead." });
      nameRef.current?.focus();
    });
  }

  return (
    <div>
      <Section
        title="Start a test"
        intro="Chat with your bot the way a lead would. Test conversations are saved like real ones, so delete them when you're done."
      >
        <StartForm projects={projects} busy={busy !== null} starting={busy === "start"} nameRef={nameRef} onStart={start} />
        <RecentList
          conversations={conversations}
          error={listError}
          currentId={viewId}
          busy={busy !== null}
          onOpen={open}
          onRetry={loadList}
        />
      </Section>

      <NoticeLine notice={notice} className="mt-6" />

      {view ? (
        <Tester
          view={view}
          pending={pending}
          elapsed={elapsed}
          busy={busy}
          strikeLimit={strikeLimit}
          onSend={send}
          onScripted={(on) => patch("scripted", { forceScripted: on })}
          onTakeover={(on) => patch("takeover", { humanTakeover: on })}
          onAgentReply={agentReply}
          onDelete={remove}
        />
      ) : (
        busy === "open" && <p className="mt-4 text-muted">Opening the conversation…</p>
      )}
    </div>
  );
}

/* ---------- Start and pick ---------- */

function StartForm({
  projects,
  busy,
  starting,
  nameRef,
  onStart,
}: {
  projects: ProjectOption[];
  busy: boolean;
  starting: boolean;
  nameRef: RefObject<HTMLInputElement | null>;
  onStart: (request: StartConversationRequest) => Promise<void>;
}) {
  const uid = useId();
  const [name, setName] = useState("Test lead");
  const [phone, setPhone] = useState("+971500000000");
  const [projectId, setProjectId] = useState("");
  const [language, setLanguage] = useState<Lang>("en");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !name.trim() || !phone.trim()) return;
    void onStart({ name: name.trim(), phone: phone.trim(), projectId: projectId || null, language });
  }

  return (
    <form onSubmit={submit} className="grid gap-5" aria-label="Start a test conversation">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Lead's name" htmlFor={`${uid}-name`}>
          <Input id={`${uid}-name`} ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} required dir="auto" />
        </Field>
        <Field label="Phone number" htmlFor={`${uid}-phone`}>
          <Input id={`${uid}-phone`} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required dir="ltr" />
        </Field>
        <Field label="Project" htmlFor={`${uid}-project`} help="The ad or listing the lead came from.">
          <Select id={`${uid}-project`} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Language" htmlFor={`${uid}-language`} help="The bot starts in this language and follows the lead if they switch.">
          <Select id={`${uid}-language`} value={language} onChange={(e) => setLanguage(e.target.value as Lang)}>
            <option value="en">English</option>
            <option value="ar">Arabic (العربية)</option>
          </Select>
        </Field>
      </div>
      <div>
        <Button type="submit" disabled={busy || !name.trim() || !phone.trim()}>
          {starting ? "Starting…" : "Start conversation"}
        </Button>
      </div>
    </form>
  );
}

function RecentList({
  conversations,
  error,
  currentId,
  busy,
  onOpen,
  onRetry,
}: {
  conversations: ConversationSummary[] | null;
  error: string | null;
  currentId: string | null;
  busy: boolean;
  onOpen: (id: string) => void;
  onRetry: () => void;
}) {
  const headingId = useId();
  return (
    <div className="mt-8 border-t border-line pt-6">
      <h3 id={headingId} className="text-[15px] font-semibold">
        Recent test conversations
      </h3>
      {error && !conversations && (
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[14px]">
          <span className="text-bad">Couldn&apos;t load them: {error}</span>
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
      {!error && !conversations && <p className="mt-2 text-[14px] text-muted">Loading…</p>}
      {conversations && conversations.length === 0 && <p className="mt-2 text-[14px] text-muted">None yet.</p>}
      {conversations && conversations.length > 0 && (
        <ul aria-labelledby={headingId} className="mt-2 divide-y divide-line border-y border-line">
          {conversations.slice(0, 12).map((c) => {
            const current = c.id === currentId;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={busy}
                  aria-current={current ? "true" : undefined}
                  onClick={() => onOpen(c.id)}
                  className={`grid w-full gap-0.5 px-2 py-2.5 text-left hover:bg-panel disabled:cursor-not-allowed ${current ? "bg-panel" : ""}`}
                >
                  <span className="flex items-baseline justify-between gap-3 text-[14px]">
                    <span className={`truncate font-medium ${current ? "text-marina" : ""}`}>
                      <bdi>{c.leadName ?? "No name"}</bdi>
                      {c.projectName && (
                        <span className="font-normal text-muted">
                          {" · "}
                          <bdi>{c.projectName}</bdi>
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-[13px] text-muted">{timeAgo(c.updatedAt)}</span>
                  </span>
                  <span dir="auto" className="truncate text-[13px] text-muted">
                    {c.lastMessage || "No messages yet"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ---------- The tester: phone, controls and side panel ---------- */

function Tester({
  view,
  pending,
  elapsed,
  busy,
  strikeLimit,
  onSend,
  onScripted,
  onTakeover,
  onAgentReply,
  onDelete,
}: {
  view: ConversationView;
  pending: PendingMessage | null;
  elapsed: number;
  busy: Busy;
  strikeLimit: number | null;
  onSend: (input: InboundInput, shownAs: string) => void;
  onScripted: (on: boolean) => void;
  onTakeover: (on: boolean) => void;
  onAgentReply: (text: string) => Promise<boolean>;
  onDelete: () => void;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="pb-10">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-line pb-4">
        <div className="min-w-0">
          <h2 id={headingId} className="text-lg font-semibold">
            Conversation with <bdi>{view.lead.name ?? "a test lead"}</bdi>
          </h2>
          <p className="text-[14px] text-muted">
            {view.lead.projectName ? <bdi>{view.lead.projectName}</bdi> : "No project"} ·{" "}
            {view.lead.language === "ar" ? "Arabic" : "English"}
            {view.humanTakeover && <span className="font-medium text-brass"> · A person is answering</span>}
          </p>
          <p className="mt-1 flex flex-wrap gap-x-4 text-[14px]">
            <Link href={`/inbox?c=${encodeURIComponent(view.id)}`} className="text-marina underline underline-offset-2">
              Open in Inbox
            </Link>
            <Link href={`/leads/${encodeURIComponent(view.lead.id)}`} className="text-marina underline underline-offset-2">
              Open the lead
            </Link>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Switch checked={view.forceScripted} onCheckedChange={onScripted} disabled={busy !== null}>
            Scripted only
          </Switch>
          <Button variant="secondary" onClick={() => onTakeover(!view.humanTakeover)} disabled={busy !== null}>
            {busy === "takeover" ? "Saving…" : view.humanTakeover ? "Hand back to the bot" : "Take over"}
          </Button>
          <Button variant="danger" className="px-0" onClick={onDelete} disabled={busy !== null}>
            {busy === "delete" ? "Deleting…" : "Delete test conversation"}
          </Button>
        </div>
      </div>

      {pending && (
        <p className="mt-3 text-[14px] text-muted">
          Waiting for the bot&apos;s reply: <span className="tabular-nums">{elapsed} s</span>.
          {elapsed >= 5 && " A local AI model can take a minute."}
        </p>
      )}

      <div className="mt-6 grid gap-8 xl:grid-cols-[22rem_minmax(0,1fr)] xl:gap-10">
        <Phone view={view} pending={pending} elapsed={elapsed} busy={busy !== null} onSend={onSend} />

        <div className="min-w-0">
          {view.humanTakeover && <AgentReplyBox busy={busy} onSend={onAgentReply} />}

          <h3 className="text-[15px] font-semibold">Last turn</h3>
          <p className="text-[13px] text-muted">Who answered the lead&apos;s last message, and why.</p>
          <div className="mt-1 border-t border-line">
            <TurnPanel trace={view.lastTrace} />
          </div>

          <h3 className="mt-8 text-[15px] font-semibold">Lead</h3>
          <p className="text-[13px] text-muted">What the bot has learned so far.</p>
          <div className="mt-1 border-t border-line">
            <LeadPanel view={view} strikeLimit={strikeLimit} />
          </div>
        </div>
      </div>
    </section>
  );
}

function AgentReplyBox({ busy, onSend }: { busy: Busy; onSend: (text: string) => Promise<boolean> }) {
  const uid = useId();
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    const ok = await onSend(body);
    if (ok) setText("");
    ref.current?.focus();
  }

  return (
    <form onSubmit={submit} className="mb-8 grid gap-3 border-l-2 border-brass pl-4">
      <Field
        label="Reply as a person"
        htmlFor={`${uid}-reply`}
        help="The bot is paused. Your reply reaches the lead as a message from your team. New messages show every 2 seconds."
      >
        <Textarea
          id={`${uid}-reply`}
          ref={ref}
          rows={3}
          value={text}
          dir="auto"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) e.currentTarget.form?.requestSubmit();
          }}
        />
      </Field>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy !== null || !text.trim()}>
          {busy === "agent" ? "Sending…" : "Send reply"}
        </Button>
        <span className="text-[13px] text-muted">Ctrl+Enter sends</span>
      </div>
    </form>
  );
}
