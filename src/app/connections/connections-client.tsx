"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button, Field, Input, Select, StatusMark, type Tone } from "@/components/ui";
import type { CheckId, CheckResult } from "@/lib/ai/checks";
import { AI_PRESETS, findPreset } from "@/lib/ai/presets";
import { announceConnectionsChanged, apiFetch } from "@/lib/api-client";
import type { ConnectionsResponse, PublicAiConnection, PublicStorageConnection } from "@/lib/connections";
import { timeAgo } from "@/lib/time";

type Notice = { tone: "ok" | "bad"; text: string } | null;
type Models = { chat: string[]; embedding: string[] };

export function ConnectionsClient() {
  const [data, setData] = useState<ConnectionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<ConnectionsResponse>("/api/connections")
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <p className="mt-8 text-bad">Couldn&apos;t load your connections: {error}</p>;
  if (!data) return <p className="mt-8 text-muted">Loading your connections…</p>;

  return (
    <div>
      <AiSection
        saved={data.ai}
        allowPrivate={data.allowPrivateEndpoints}
        onSaved={(ai) => {
          setData((d) => d && { ...d, ai });
          announceConnectionsChanged();
        }}
      />
      <StorageSection
        saved={data.storage}
        onSaved={(storage) => {
          setData((d) => d && { ...d, storage });
          announceConnectionsChanged();
        }}
      />
      <LaterSection />
    </div>
  );
}

function Section({ title, intro, aside, children }: { title: string; intro: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-6 border-b border-line py-9 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] md:gap-12">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <div className="mt-2 text-[14px] leading-relaxed text-muted">{intro}</div>
        {aside && <div className="mt-5">{aside}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function NoticeLine({ notice }: { notice: Notice }) {
  return (
    <p role="status" className={`min-h-5 text-[14px] ${notice?.tone === "bad" ? "text-bad" : "text-ok"}`}>
      {notice?.text}
    </p>
  );
}

/* ---------- AI model ---------- */

const AI_SUMMARY: Record<string, [Tone, string]> = {
  ok: ["ok", "Ready for the AI agent."],
  warning: ["warn", "Connected, but not ready for the AI agent. See the failed checks."],
  error: ["bad", "Not working. See the first check."],
  untested: ["muted", "Saved, not tested yet."],
};

function aiSummary(saved: PublicAiConnection | null): [Tone, string] {
  if (!saved) return ["muted", "Not connected. The bot uses the scripted flow."];
  const optionalFailed = saved.lastCheck?.results.some((r) => !r.required && r.status === "fail");
  if (saved.status === "ok" && optionalFailed) return ["ok", "Ready for the AI agent, with limits. See the failed checks."];
  return AI_SUMMARY[saved.status] ?? AI_SUMMARY.untested;
}

const CHECK_PURPOSE: Record<CheckId, string> = {
  reply: "The basic test: the model answers a message.",
  tools: "Needed to look up listings, search your documents and book viewings.",
  json: "Needed to save each lead's answers reliably.",
  arabic: "Recommended for leads who write in Arabic.",
  embeddings: "Optional. Lets document search match meaning, not just words.",
  scope: "Optional. Checks the separate model you chose for the topic check.",
};

function checkTone(result: CheckResult): [Tone, string] {
  if (result.status === "pass") return ["ok", "Passed"];
  if (result.status === "skipped") return ["muted", "Skipped"];
  return result.required ? ["bad", "Failed"] : ["warn", "Failed"];
}

function AiSection({
  saved,
  allowPrivate,
  onSaved,
}: {
  saved: PublicAiConnection | null;
  allowPrivate: boolean;
  onSaved: (ai: PublicAiConnection | null) => void;
}) {
  const initial = saved?.config;
  const [preset, setPreset] = useState(initial?.preset ?? "lmstudio");
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? findPreset("lmstudio").baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [chatModel, setChatModel] = useState(initial?.chatModel ?? "");
  const [embeddingModel, setEmbeddingModel] = useState(initial?.embeddingModel ?? "");
  const [scopeModel, setScopeModel] = useState(initial?.scopeModel ?? "");
  const [models, setModels] = useState<Models | null>(null);
  const [busy, setBusy] = useState<null | "models" | "save" | "test" | "remove">(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [elapsed, setElapsed] = useState(0);

  const presetInfo = findPreset(preset);
  const dirty =
    !initial ||
    initial.preset !== preset ||
    initial.baseUrl !== baseUrl ||
    initial.chatModel !== chatModel ||
    initial.embeddingModel !== embeddingModel ||
    initial.scopeModel !== scopeModel ||
    apiKey !== "" ||
    clearKey;

  // Count seconds while the checks run; a local model can take a minute.
  useEffect(() => {
    if (busy !== "test") return;
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  function choosePreset(id: string) {
    setPreset(id);
    const next = findPreset(id);
    if (next.baseUrl) setBaseUrl(next.baseUrl);
    setModels(null);
    setNotice(null);
  }

  async function loadModels() {
    setBusy("models");
    setNotice(null);
    try {
      const list = await apiFetch<Models>("/api/connections/ai/models", {
        method: "POST",
        json: { baseUrl, apiKey: apiKey || undefined },
      });
      setModels(list);
      if (!chatModel && list.chat[0]) setChatModel(list.chat[0]);
      if (!embeddingModel && list.embedding[0]) setEmbeddingModel(list.embedding[0]);
      setNotice(
        list.chat.length
          ? { tone: "ok", text: `Found ${list.chat.length} chat and ${list.embedding.length} embedding model${list.embedding.length === 1 ? "" : "s"}.` }
          : { tone: "bad", text: "The server answered but has no chat models loaded. Load one in your server and try again." },
      );
    } catch (err) {
      setModels(null);
      setNotice({ tone: "bad", text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    setNotice(null);
    try {
      const res = await apiFetch<{ ai: PublicAiConnection; keyDropped: boolean }>("/api/connections/ai", {
        method: "PUT",
        json: {
          preset,
          baseUrl,
          chatModel,
          embeddingModel,
          scopeModel,
          apiKey: apiKey || undefined,
          clearKey: clearKey || undefined,
        },
      });
      setApiKey("");
      setClearKey(false);
      onSaved(res.ai);
      setNotice({
        tone: "ok",
        text: res.keyDropped
          ? "Saved. The old key was removed because the server address changed; add this server's key if it needs one."
          : "Saved. Run the test to confirm the model works.",
      });
    } catch (err) {
      setNotice({ tone: "bad", text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setElapsed(0);
    setBusy("test");
    setNotice(null);
    try {
      const res = await apiFetch<{ ai: PublicAiConnection }>("/api/connections/ai/test", { method: "POST" });
      onSaved(res.ai);
    } catch (err) {
      setNotice({ tone: "bad", text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!window.confirm("Remove the AI connection? The bot will use the scripted flow until you connect a model again.")) return;
    setBusy("remove");
    setNotice(null);
    try {
      await apiFetch("/api/connections/ai", { method: "DELETE" });
      onSaved(null);
      setNotice({ tone: "ok", text: "Removed. The bot now uses the scripted flow." });
    } catch (err) {
      setNotice({ tone: "bad", text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const [summaryTone, summaryText] = aiSummary(saved);
  const isLocalAddress = /^https?:\/\/(localhost|127\.|\[::1\])/i.test(baseUrl);
  const run = saved?.lastCheck;

  return (
    <Section
      title="AI model"
      intro="Runs the conversations, document answers and lead summaries. Without it, the bot asks its scripted questions instead."
      aside={
        <div className="grid gap-1">
          <StatusMark tone={summaryTone}>{summaryText}</StatusMark>
          {saved?.lastCheckedAt && <span className="pl-4 text-[13px] text-muted">Tested {timeAgo(saved.lastCheckedAt)}</span>}
        </div>
      }
    >
      <div className="grid gap-5">
        <Field label="Provider" htmlFor="ai-preset" help={presetInfo.note}>
          <Select id="ai-preset" value={preset} onChange={(e) => choosePreset(e.target.value)}>
            {AI_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Server address"
          htmlFor="ai-url"
          help={
            isLocalAddress && !allowPrivate
              ? "Addresses on this computer are blocked. Set ALLOW_PRIVATE_ENDPOINTS=true in .env to use a local server."
              : "The OpenAI-compatible address, usually ending in /v1."
          }
        >
          <Input id="ai-url" type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} spellCheck={false} />
        </Field>

        <Field
          label="API key"
          htmlFor="ai-key"
          help={
            <>
              Stored encrypted and never shown again.
              {presetInfo.keyUrl && (
                <>
                  {" "}
                  <a href={presetInfo.keyUrl} target="_blank" rel="noreferrer" className="text-marina underline underline-offset-2">
                    Get a {presetInfo.label} key
                  </a>
                </>
              )}
            </>
          }
        >
          <Input
            id="ai-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={
              saved?.hasKey ? "A key is saved. Type a new one to replace it." : presetInfo.needsKey ? "Paste your key" : "Not needed for local servers"
            }
          />
          {saved?.hasKey && (
            <label className="mt-1 inline-flex items-center gap-2 text-[14px]">
              <input type="checkbox" checked={clearKey} onChange={(e) => setClearKey(e.target.checked)} />
              Remove the saved key
            </label>
          )}
        </Field>

        <div className="grid gap-4 border-t border-line pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[14px] text-muted">Pick models from the server, or type their names.</p>
            <Button variant="secondary" onClick={loadModels} disabled={busy !== null || !baseUrl}>
              {busy === "models" ? "Loading models…" : "Load models"}
            </Button>
          </div>

          <datalist id="chat-models">{models?.chat.map((m) => <option key={m} value={m} />)}</datalist>
          <datalist id="embedding-models">{models?.embedding.map((m) => <option key={m} value={m} />)}</datalist>

          <Field label="Chat model" htmlFor="ai-chat-model">
            <Input id="ai-chat-model" list="chat-models" value={chatModel} onChange={(e) => setChatModel(e.target.value)} spellCheck={false} />
          </Field>
          <Field
            label="Embedding model"
            htmlFor="ai-embedding-model"
            help="Optional. Lets document search match meaning. Pick a multilingual model (like multilingual-e5 or bge-m3) so Arabic questions match English documents. Leave it empty to match keywords only."
          >
            <Input
              id="ai-embedding-model"
              list="embedding-models"
              value={embeddingModel}
              onChange={(e) => setEmbeddingModel(e.target.value)}
              spellCheck={false}
            />
          </Field>
          <Field
            label="Topic check model"
            htmlFor="ai-scope-model"
            help="Optional. A small, fast model that checks each message is about property before the main model replies. Leave it empty to use the chat model."
          >
            <Input id="ai-scope-model" list="chat-models" value={scopeModel} onChange={(e) => setScopeModel(e.target.value)} spellCheck={false} />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
          <Button onClick={save} disabled={busy !== null || !dirty || !chatModel || !baseUrl}>
            {busy === "save" ? "Saving…" : "Save connection"}
          </Button>
          <Button variant="secondary" onClick={test} disabled={busy !== null || !saved || dirty}>
            {busy === "test" ? `Testing… ${elapsed} s` : "Test connection"}
          </Button>
          {saved && (
            <Button variant="danger" className="ml-auto" onClick={remove} disabled={busy !== null}>
              Remove connection
            </Button>
          )}
        </div>
        <div className="-mt-2 grid gap-1">
          {saved && dirty && busy === null && <p className="text-[14px] text-muted">Save your changes before testing.</p>}
          {busy === "test" && (
            <p className="text-[14px] text-muted">The checks run one at a time. A local model can take a minute or two.</p>
          )}
          <NoticeLine notice={notice} />
        </div>

        {run?.notes?.map((note) => (
          <p key={note} className="border-l-2 border-warn pl-3 text-[14px] leading-relaxed">
            {note}
          </p>
        ))}

        {run && (
          <ul className="divide-y divide-line border-y border-line" aria-label="Connection checks">
            {run.results.map((result) => {
              const [tone, word] = checkTone(result);
              return (
                <li key={result.id} className="grid items-start gap-1 py-3.5 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-4">
                  <StatusMark tone={tone}>{word}</StatusMark>
                  <div className="min-w-0">
                    <p className="font-medium">{result.label}</p>
                    <p className="text-[13px] text-muted">{CHECK_PURPOSE[result.id]}</p>
                    <p dir="auto" className="mt-1 text-[14px] leading-relaxed">
                      {result.detail}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Section>
  );
}

/* ---------- File storage ---------- */

const STORAGE_SUMMARY: Record<string, [Tone, string]> = {
  ok: ["ok", "Ready for uploads."],
  error: ["bad", "Not working. See the test result."],
  untested: ["muted", "Saved, not tested yet."],
};

function StorageSection({
  saved,
  onSaved,
}: {
  saved: PublicStorageConnection | null;
  onSaved: (storage: PublicStorageConnection | null) => void;
}) {
  const [folder, setFolder] = useState(saved?.config?.path ?? "./storage");
  const [busy, setBusy] = useState<null | "save" | "test" | "remove">(null);
  const [notice, setNotice] = useState<Notice>(null);
  const dirty = folder !== saved?.config?.path;

  async function save() {
    setBusy("save");
    setNotice(null);
    try {
      const res = await apiFetch<{ storage: PublicStorageConnection }>("/api/connections/storage", {
        method: "PUT",
        json: { path: folder },
      });
      onSaved(res.storage);
      setNotice({ tone: "ok", text: "Saved. Run the test to check files can be written there." });
    } catch (err) {
      setNotice({ tone: "bad", text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    setNotice(null);
    try {
      const res = await apiFetch<{ storage: PublicStorageConnection }>("/api/connections/storage/test", { method: "POST" });
      onSaved(res.storage);
    } catch (err) {
      setNotice({ tone: "bad", text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!window.confirm("Disconnect this folder? Files already in it stay where they are.")) return;
    setBusy("remove");
    try {
      await apiFetch("/api/connections/storage", { method: "DELETE" });
      onSaved(null);
      setNotice({ tone: "ok", text: "Disconnected. Uploads are off until you connect storage again." });
    } catch (err) {
      setNotice({ tone: "bad", text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const [tone, text] = saved ? (STORAGE_SUMMARY[saved.status] ?? STORAGE_SUMMARY.untested) : (["muted", "Not connected. Document uploads are off."] as [Tone, string]);

  return (
    <Section
      title="File storage"
      intro="Where uploaded brochures and documents are kept. For now it's a folder on this computer; your own cloud bucket comes later."
      aside={
        <div className="grid gap-1">
          <StatusMark tone={tone}>{text}</StatusMark>
          {saved?.lastCheckedAt && <span className="pl-4 text-[13px] text-muted">Tested {timeAgo(saved.lastCheckedAt)}</span>}
        </div>
      }
    >
      <div className="grid gap-5">
        <Field
          label="Folder"
          htmlFor="storage-folder"
          help={
            saved?.config
              ? `Files go to ${saved.config.resolvedPath}`
              : "A path relative to the project, or a full path. It's created if it doesn't exist."
          }
        >
          <Input id="storage-folder" value={folder} onChange={(e) => setFolder(e.target.value)} spellCheck={false} />
        </Field>

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
          <Button onClick={save} disabled={busy !== null || !dirty || !folder}>
            {busy === "save" ? "Saving…" : "Use this folder"}
          </Button>
          <Button variant="secondary" onClick={test} disabled={busy !== null || !saved || dirty}>
            {busy === "test" ? "Testing…" : "Test storage"}
          </Button>
          {saved && (
            <Button variant="danger" className="ml-auto" onClick={remove} disabled={busy !== null}>
              Disconnect
            </Button>
          )}
        </div>
        <div className="-mt-2 grid gap-1">
          {saved?.lastCheck && (
            <p className={`text-[14px] ${saved.lastCheck.status === "ok" ? "text-ink" : "text-bad"}`}>{saved.lastCheck.detail}</p>
          )}
          <NoticeLine notice={notice} />
        </div>
      </div>
    </Section>
  );
}

/* ---------- Coming later ---------- */

const LATER = [
  { name: "Claude by Anthropic", when: "Next", text: "Claude through Anthropic's own API, with full support for its features." },
  { name: "WhatsApp", when: "Phase 2", text: "Your own WhatsApp Business account, from Meta directly or through 360dialog." },
  { name: "SMS", when: "Phase 3", text: "Your own Twilio or Unifonic account." },
  { name: "Email to leads", when: "Phase 3", text: "Your own SMTP, Resend or SendGrid account." },
  { name: "Cloud storage bucket", when: "Later", text: "Cloudflare R2, AWS S3, Backblaze B2 or any S3-compatible bucket." },
];

function LaterSection() {
  return (
    <Section title="Coming later" intro="These will connect to your own accounts too. They aren't built yet.">
      <table className="w-full text-left text-[14px]">
        <thead className="sr-only">
          <tr>
            <th>Connection</th>
            <th>When</th>
            <th>What you connect</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line border-y border-line">
          {LATER.map((item) => (
            <tr key={item.name} className="align-baseline">
              <td className="py-3 pr-4 font-medium">{item.name}</td>
              <td className="whitespace-nowrap py-3 pr-4 text-brass">{item.when}</td>
              <td className="py-3 text-muted">{item.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}
