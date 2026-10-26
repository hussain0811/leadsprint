import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { Button, Field, Input, StatusMark, TextButton, type Tone } from "@/components/ui";
import { apiFetch } from "@/lib/api-client";
import type { KnowledgeSourceView, ProjectOption, SourceDetail, SourceRole, SourceStatus } from "@/lib/knowledge/types";
import { timeAgo } from "@/lib/time";
import {
  count,
  errorText,
  formatBytes,
  formatDate,
  formatNumber,
  isPastDate,
  isStuck,
  LINK,
  NoticeLine,
  PlaceLabel,
  ProjectSelect,
  restoreFocus,
  RoleChoice,
  Section,
  sentence,
  sourcePath,
  toDateInput,
  useElapsed,
  type Notice,
} from "./shared";

const STATUS: Record<SourceStatus, [Tone, string]> = {
  ready: ["ok", "Ready"],
  processing: ["muted", "Processing"],
  failed: ["bad", "Failed"],
};

const FIRST_PASSAGES = 5;

// The file name from a Content-Disposition header, preferring the exact UTF-8 form (Arabic names).
function fileNameFrom(header: string | null) {
  if (!header) return null;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {
      // fall through to the plain name
    }
  }
  return /filename="([^"]+)"/i.exec(header)?.[1] ?? null;
}

export function Documents({
  sources,
  projects,
  meaningSearch,
  onSaved,
  onDeleted,
}: {
  sources: KnowledgeSourceView[];
  projects: ProjectOption[];
  meaningSearch: boolean; // an embedding model is set, so passage counts include meaning search
  onSaved: (source: KnowledgeSourceView) => void;
  onDeleted: (id: string) => void;
}) {
  const [notice, setNotice] = useState<Notice>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const rulesCount = sources.filter((s) => s.role === "rules").length;
  const failedCount = sources.filter((s) => s.status === "failed").length;

  function deleted(source: KnowledgeSourceView) {
    onDeleted(source.id);
    setNotice({
      tone: "ok",
      text: (
        <>
          Deleted “<bdi>{source.title}</bdi>”.
        </>
      ),
    });
    // The row and its buttons are gone, so keep keyboard focus here rather than losing it to the page.
    noticeRef.current?.focus();
  }

  return (
    <Section
      title="Documents"
      intro="Everything the AI can read. Rules are marked in gold and apply to every reply. Reference documents are searched when a question needs them."
      aside={
        sources.length > 0 && (
          <div className="grid gap-1.5 text-[14px]">
            <span>{count(sources.length, "document")}</span>
            {rulesCount > 0 && <span className="text-brass">{rulesCount === 1 ? "1 is rules" : `${rulesCount} are rules`}</span>}
            {failedCount > 0 && <StatusMark tone="bad">{`${formatNumber(failedCount)} failed`}</StatusMark>}
          </div>
        )
      }
    >
      <NoticeLine ref={noticeRef} notice={notice} reserve={false} className={notice ? "mb-3" : ""} />
      {sources.length === 0 ? (
        <p className="text-[15px] leading-relaxed text-muted">
          No documents yet. Add brochures, payment plans and FAQs as reference, and your terms and conditions as rules.
        </p>
      ) : (
        <ul className="divide-y divide-line border-y border-line" aria-label="Documents">
          {sources.map((source) => (
            <DocumentRow
              key={source.id}
              source={source}
              projects={projects}
              meaningSearch={meaningSearch}
              onSaved={onSaved}
              onDeleted={deleted}
            />
          ))}
        </ul>
      )}
    </Section>
  );
}

function Origin({ source }: { source: KnowledgeSourceView }) {
  if (source.kind === "url" && source.url) {
    return /^https?:\/\//i.test(source.url) ? (
      <a href={source.url} target="_blank" rel="noreferrer" className={LINK}>
        {source.url}
      </a>
    ) : (
      <>{source.url}</>
    );
  }
  if (source.kind === "file") {
    return (
      <>
        <bdi>{source.fileName ?? "Uploaded file"}</bdi>
        {source.sizeBytes !== null && `, ${formatBytes(source.sizeBytes)}`}
      </>
    );
  }
  return <>Written here</>;
}

function stats(source: KnowledgeSourceView, meaningSearch: boolean) {
  if (source.status === "processing") return isStuck(source) ? "" : "Reading it now.";
  if (source.status === "failed") return "";
  const parts: string[] = [];
  if (source.pageCount) parts.push(count(source.pageCount, "page"));
  parts.push(count(source.charCount, "character"));
  // Rules aren't split into passages: the whole text goes with every reply.
  if (source.role === "rules") return `${parts.join(", ")}, sent whole with every AI reply.`;
  parts.push(count(source.chunkCount, "passage"));
  if (meaningSearch && source.role === "reference" && source.chunkCount > 0) {
    parts.push(
      source.embeddedCount >= source.chunkCount
        ? "all with meaning search"
        : source.embeddedCount === 0
          ? "none with meaning search yet"
          : `${formatNumber(source.embeddedCount)} with meaning search`,
    );
  }
  return `${parts.join(", ")}.`;
}

function DocumentRow({
  source,
  projects,
  meaningSearch,
  onSaved,
  onDeleted,
}: {
  source: KnowledgeSourceView;
  projects: ProjectOption[];
  meaningSearch: boolean;
  onSaved: (source: KnowledgeSourceView) => void;
  onDeleted: (source: KnowledgeSourceView) => void;
}) {
  const uid = useId();
  const editButton = useRef<HTMLButtonElement>(null);
  const reprocessButton = useRef<HTMLButtonElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const downloadButton = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<{ action: "reprocess" | "delete" | "download"; since: number } | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const seconds = useElapsed(busy?.since ?? null);

  const stuck = isStuck(source);
  const processing = source.status === "processing";
  const [tone, word] = stuck ? (["warn", "Stalled"] as [Tone, string]) : (STATUS[source.status] ?? STATUS.processing);
  const rules = source.role === "rules";
  const detailsId = `${uid}-details`;
  const editId = `${uid}-edit`;

  function closeEditor(outcome?: Notice) {
    setEditing(false);
    if (outcome) setNotice(outcome);
    editButton.current?.focus();
  }

  async function reprocess() {
    setBusy({ action: "reprocess", since: Date.now() });
    setNotice({ tone: "muted", text: source.kind === "url" ? "Fetching the page again and reading it." : "Reading it again." });
    try {
      const res = await apiFetch<{ source: KnowledgeSourceView }>(sourcePath(source.id, "/reprocess"), { method: "POST" });
      onSaved(res.source);
      if (res.source.status === "failed") {
        setNotice({ tone: "bad", text: "Reprocessed, but the AI still can't use it. The reason is shown above." });
      } else if (res.source.status === "processing") {
        setNotice({ tone: "muted", text: "Still processing. Its status above changes when it's done." });
      } else if (res.source.role === "rules") {
        setNotice({ tone: "ok", text: "Reprocessed. It applies to every AI reply." });
      } else {
        setNotice({ tone: "ok", text: `Reprocessed. It now has ${count(res.source.chunkCount, "passage")}.` });
      }
    } catch (err) {
      setNotice({ tone: "bad", text: errorText(err) });
    } finally {
      flushSync(() => setBusy(null));
      restoreFocus(reprocessButton.current);
    }
  }

  // Fetch the file ourselves rather than following a link, so a server message such as "missing from
  // storage" shows here instead of as a generic browser download failure.
  async function download() {
    setBusy({ action: "download", since: Date.now() });
    setNotice(null);
    try {
      const res = await fetch(sourcePath(source.id, "/file"));
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `The download failed (status ${res.status}).`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileNameFrom(res.headers.get("content-disposition")) ?? source.fileName ?? "document";
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setNotice({ tone: "bad", text: errorText(err) });
    } finally {
      flushSync(() => setBusy(null));
      restoreFocus(downloadButton.current);
    }
  }

  async function remove() {
    const alsoFile = source.kind === "file" ? " The original file is removed from storage too." : "";
    if (!window.confirm(`Delete “${source.title}”? The AI stops using it straight away.${alsoFile} This can't be undone.`)) return;
    setBusy({ action: "delete", since: Date.now() });
    setNotice(null);
    try {
      await apiFetch<{ ok: true }>(sourcePath(source.id), { method: "DELETE" });
      onDeleted(source);
    } catch (err) {
      flushSync(() => {
        setNotice({ tone: "bad", text: errorText(err) });
        setBusy(null);
      });
      restoreFocus(deleteButton.current);
    }
  }

  const detailLine = stats(source, meaningSearch);

  return (
    <li className={`border-l-2 py-4 pl-4 ${rules ? "border-brass" : "border-transparent"}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-1">
        <div className="min-w-0 flex-1">
          {/* dir="auto" on an inline span: an Arabic title reads right to left but stays lined up with the list. */}
          <h3 className="font-medium leading-snug wrap-break-word">
            <span dir="auto">{source.title}</span>
          </h3>
          <p className="mt-0.5 text-[13px] text-muted wrap-anywhere">
            <Origin source={source} />
          </p>
        </div>
        <StatusMark tone={tone}>{word}</StatusMark>
      </div>

      <p className="mt-2 text-[14px] leading-relaxed">
        <span className={rules ? "font-medium text-brass" : ""}>{rules ? "Rules" : "Reference"}</span> for{" "}
        {source.projectId ? <bdi>{source.projectName ?? "one project"}</bdi> : "all projects"}.
        {source.validUntil &&
          (isPastDate(source.validUntil) ? (
            <span className="text-warn"> Expired on {formatDate(source.validUntil)}, so the AI no longer uses it.</span>
          ) : (
            <> Valid until {formatDate(source.validUntil)}.</>
          ))}
      </p>
      <p className="text-[13px] leading-relaxed text-muted">
        {detailLine && `${detailLine} `}Updated {timeAgo(source.updatedAt)}.
      </p>
      {stuck && (
        <p className="mt-1 text-[14px] leading-relaxed text-warn">
          It has been processing for over 5 minutes, so it was probably interrupted. Reprocess it.
        </p>
      )}
      {source.status === "failed" && (
        <p dir="auto" className="mt-1 text-[14px] leading-relaxed text-bad wrap-break-word">
          {sentence(source.error) || "Processing failed, and no reason was given."}
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1">
        <TextButton aria-expanded={open} aria-controls={open ? detailsId : undefined} onClick={() => setOpen((o) => !o)}>
          {open ? "Hide" : "View"}
        </TextButton>
        <TextButton
          ref={editButton}
          aria-label={`Edit “${source.title}”`}
          aria-expanded={editing}
          aria-controls={editing ? editId : undefined}
          onClick={() => (editing ? closeEditor() : setEditing(true))}
          disabled={processing}
        >
          Edit
        </TextButton>
        <TextButton ref={reprocessButton} onClick={reprocess} disabled={busy !== null || (processing && !stuck)}>
          {busy?.action === "reprocess" ? `Reprocessing… ${seconds} s` : "Reprocess"}
        </TextButton>
        {source.kind === "file" && (
          <TextButton ref={downloadButton} onClick={download} disabled={busy !== null}>
            {busy?.action === "download" ? "Downloading…" : "Download original"}
          </TextButton>
        )}
        <TextButton
          ref={deleteButton}
          aria-label={`Delete “${source.title}”`}
          tone="bad"
          className="ml-auto"
          onClick={remove}
          disabled={busy !== null}
        >
          {busy?.action === "delete" ? "Deleting…" : "Delete"}
        </TextButton>
      </div>
      <NoticeLine notice={notice} reserve={false} className="mt-1" />

      {editing && !processing && <EditSource id={editId} source={source} projects={projects} onSaved={onSaved} onClose={closeEditor} />}
      {open && <SourceDetails id={detailsId} source={source} />}
    </li>
  );
}

/* ---------- Edit ---------- */

function EditSource({
  id,
  source,
  projects,
  onSaved,
  onClose,
}: {
  id: string;
  source: KnowledgeSourceView;
  projects: ProjectOption[];
  onSaved: (source: KnowledgeSourceView) => void;
  onClose: (outcome?: Notice) => void;
}) {
  const uid = useId();
  const [title, setTitle] = useState(source.title);
  const [role, setRole] = useState<SourceRole>(source.role);
  const [projectId, setProjectId] = useState(source.projectId ?? "");
  const [validUntil, setValidUntil] = useState(toDateInput(source.validUntil));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const saveButton = useRef<HTMLButtonElement>(null);

  // Send only what changed.
  const changes: { title?: string; role?: SourceRole; projectId?: string | null; validUntil?: string | null } = {};
  if (title.trim() !== source.title) changes.title = title.trim();
  if (role !== source.role) changes.role = role;
  if ((projectId || null) !== source.projectId) changes.projectId = projectId || null;
  if (validUntil !== toDateInput(source.validUntil)) changes.validUntil = validUntil || null;
  const dirty = Object.keys(changes).length > 0;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !dirty || !title.trim()) return;
    setSaving(true);
    setNotice(null);
    try {
      const res = await apiFetch<{ source: KnowledgeSourceView }>(sourcePath(source.id), { method: "PATCH", json: changes });
      onSaved(res.source);
      // A new role or project means it's processed again, which can fail (rules over the limit, say).
      onClose(
        res.source.status === "failed"
          ? { tone: "bad", text: "Saved, but the AI can't use it now. The reason is shown above." }
          : { tone: "ok", text: "Saved." },
      );
    } catch (err) {
      flushSync(() => {
        setNotice({ tone: "bad", text: errorText(err) });
        setSaving(false);
      });
      restoreFocus(saveButton.current);
    }
  }

  return (
    <form id={id} onSubmit={save} aria-label={`Edit ${source.title}`} className="mt-4 grid gap-4 border-t border-line pt-4">
      <Field label="Title" htmlFor={`${uid}-title`}>
        <Input
          id={`${uid}-title`}
          dir="auto"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          autoFocus
        />
      </Field>
      <div>
        <RoleChoice value={role} onChange={setRole} compact />
        {role !== source.role && (
          <p className="mt-1.5 text-[13px] leading-snug text-muted">
            {role === "rules"
              ? "As rules, it goes with every AI reply and counts toward the rules limit."
              : "As reference, it's searched only when a question needs it."}
          </p>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Project" htmlFor={`${uid}-project`}>
          <ProjectSelect id={`${uid}-project`} value={projectId} onChange={setProjectId} projects={projects} />
        </Field>
        <Field label="Valid until" htmlFor={`${uid}-valid`} help="Optional. Clear it to use it with no end date.">
          <Input id={`${uid}-valid`} type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button ref={saveButton} type="submit" disabled={saving || !dirty || !title.trim()}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
        <Button variant="secondary" onClick={() => onClose()} disabled={saving}>
          Cancel
        </Button>
      </div>
      <NoticeLine notice={notice} reserve={false} />
    </form>
  );
}

/* ---------- View ---------- */

type DetailLoad = { key: string; detail: SourceDetail | null; error: string | null };

function SourceDetails({ id, source }: { id: string; source: KnowledgeSourceView }) {
  const [attempt, setAttempt] = useState(0);
  const [load, setLoad] = useState<DetailLoad | null>(null);
  const [showAll, setShowAll] = useState(false);

  // Fetch again whenever the document changes (after a reprocess or edit) or on a retry.
  const key = `${source.updatedAt}#${attempt}`;
  useEffect(() => {
    let cancelled = false;
    apiFetch<SourceDetail>(sourcePath(source.id))
      .then((detail) => {
        if (!cancelled) setLoad({ key, detail, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoad({ key, detail: null, error: errorText(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [source.id, key]);

  const loading = load?.key !== key;
  const detail = load?.detail ?? null; // keep showing the last text while a refresh loads
  const error = loading ? null : (load?.error ?? null);
  const rules = source.role === "rules";
  const chunks = detail ? (showAll ? detail.chunks : detail.chunks.slice(0, FIRST_PASSAGES)) : [];

  return (
    <div id={id} className="mt-4 border-t border-line pt-4">
      <p role="status" className={`text-[14px] ${error ? "text-bad" : "text-muted"}`}>
        {loading ? "Loading the text…" : error ? `Couldn't load the text: ${error}` : ""}
      </p>
      {error && (
        <TextButton className="mt-1" onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </TextButton>
      )}

      {detail && (
        <div className="grid gap-6">
          <div>
            <h4 className="text-[14px] font-medium">Text preview</h4>
            <p className="text-[13px] text-muted">
              {detail.textPreview.length < detail.charCount
                ? `The first ${formatNumber(detail.textPreview.length)} of ${formatNumber(detail.charCount)} characters.`
                : `All ${count(detail.charCount, "character")}.`}
              {rules && " As rules, the AI gets the whole text with every reply."}
            </p>
            {detail.textPreview ? (
              <div
                tabIndex={0}
                role="region"
                aria-label={`Text preview of ${source.title}`}
                dir="auto"
                className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-[4px] border border-line bg-panel px-4 py-3 text-[14px] leading-relaxed wrap-break-word"
              >
                {detail.textPreview}
              </div>
            ) : (
              <p className="mt-2 text-[14px]">No text was found in it.</p>
            )}
          </div>

          {/* Rules have no passages: the whole text goes with every reply. */}
          {!rules && (
            <div>
              <h4 className="text-[14px] font-medium">Passages</h4>
              <p className="text-[13px] text-muted">
                {detail.chunks.length === 0
                  ? "No passages yet."
                  : `Split into ${count(detail.chunks.length, "passage")}. Search returns the ones that best match a question.`}
              </p>
              {chunks.length > 0 && (
                <ol className="mt-2 divide-y divide-line border-y border-line">
                  {chunks.map((chunk) => (
                    <li key={chunk.ordinal} className="py-3">
                      {(chunk.page !== null || chunk.heading) && (
                        <p className="text-[13px] text-muted">
                          <PlaceLabel page={chunk.page} heading={chunk.heading} />
                        </p>
                      )}
                      <p dir="auto" className="whitespace-pre-wrap text-[14px] leading-relaxed wrap-break-word">
                        {chunk.text}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
              {detail.chunks.length > FIRST_PASSAGES && (
                <TextButton className="mt-2" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
                  {showAll ? `Show the first ${FIRST_PASSAGES} only` : `Show all ${formatNumber(detail.chunks.length)} passages`}
                </TextButton>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
