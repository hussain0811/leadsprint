import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { apiFetch } from "@/lib/api-client";
import {
  ACCEPTED_EXTENSIONS,
  MAX_UPLOAD_BYTES,
  type KnowledgeOverview,
  type KnowledgeSourceView,
  type ProjectOption,
  type SourceRole,
} from "@/lib/knowledge/types";
import {
  ConnectionsLink,
  count,
  errorText,
  formatBytes,
  formatNumber,
  listJoin,
  NoticeLine,
  ProjectSelect,
  restoreFocus,
  RoleChoice,
  Section,
  sentence,
  useElapsed,
  type Notice,
} from "./shared";

type Mode = "file" | "page" | "text";

const MODES: Array<{ id: Mode; label: string; submit: string; working: string }> = [
  { id: "file", label: "File", submit: "Upload file", working: "Uploading…" },
  { id: "page", label: "Web page", submit: "Add page", working: "Reading the page…" },
  { id: "text", label: "Text", submit: "Add text", working: "Saving…" },
];

const TYPE_NAMES: Record<string, string> = {
  ".pdf": "PDF",
  ".docx": "Word (.docx)",
  ".xlsx": "Excel (.xlsx)",
  ".csv": "CSV",
  ".txt": "plain text",
  ".md": "Markdown",
};
const ACCEPTED_TEXT = listJoin(
  ACCEPTED_EXTENSIONS.map((ext) => TYPE_NAMES[ext] ?? ext),
  "or",
);

function fileProblem(file: File) {
  const dot = file.name.lastIndexOf(".");
  const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
  if (!(ACCEPTED_EXTENSIONS as readonly string[]).includes(ext)) {
    return `LeadSprint can't read this kind of file. Choose a ${ACCEPTED_TEXT} file.`;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `This file is ${formatBytes(file.size)}. Files can be up to ${formatBytes(MAX_UPLOAD_BYTES)}.`;
  }
  if (file.size === 0) return "This file is empty.";
  return null;
}

// The same file already uploaded for this project. The server's message names the existing document.
class DuplicateUpload extends Error {}

async function uploadFile(form: FormData): Promise<{ source: KnowledgeSourceView }> {
  const res = await fetch("/api/knowledge/files", { method: "POST", body: form });
  const body = await res.json().catch(() => null);
  if (res.status === 409) throw new DuplicateUpload(body?.error ?? "This file is already in your documents.");
  if (!res.ok) throw new Error(body?.error ?? `The upload failed (status ${res.status}).`);
  return body as { source: KnowledgeSourceView };
}

function progress(mode: Mode, name: string): ReactNode {
  if (mode === "file") {
    return (
      <>
        Uploading <bdi>{name}</bdi> and reading it. A large file can take a minute.
      </>
    );
  }
  if (mode === "page") return <span className="wrap-anywhere">Fetching {name} and reading it.</span>;
  return (
    <>
      Saving “<bdi>{name}</bdi>”.
    </>
  );
}

function outcome(source: KnowledgeSourceView): Notice {
  const name = (
    <>
      “<bdi>{source.title}</bdi>”
    </>
  );
  if (source.status === "failed") {
    return {
      tone: "bad",
      text: (
        <>
          {name} was added, but the AI can&apos;t use it yet. <bdi>{sentence(source.error) || "No reason was given."}</bdi>{" "}
          You can edit, reprocess or delete it in the list below.
        </>
      ),
    };
  }
  if (source.status === "processing") {
    return { tone: "muted", text: <>{name} is still processing. The list below shows when it&apos;s ready.</> };
  }
  if (source.role === "rules") return { tone: "ok", text: <>Ready. {name} now applies to every AI reply.</> };
  const size = [source.pageCount ? count(source.pageCount, "page") : null, count(source.chunkCount, "passage")]
    .filter(Boolean)
    .join(" and ");
  return { tone: "ok", text: <>Ready. {name} has {size} the AI can search.</> };
}

function ModeTabs({ value, onChange }: { value: Mode; onChange: (mode: Mode) => void }) {
  const name = useId();
  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">What to add</legend>
      <div className="flex flex-wrap gap-x-7 border-b border-line">
        {MODES.map((m) => {
          const active = m.id === value;
          return (
            <label
              key={m.id}
              className={`relative -mb-px cursor-pointer border-b-2 pb-2.5 text-[15px] font-medium transition-colors has-[:disabled]:cursor-not-allowed has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-4 has-[:focus-visible]:outline-brass ${
                active ? "border-marina text-ink" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              <input
                type="radio"
                name={name}
                value={m.id}
                checked={active}
                onChange={() => onChange(m.id)}
                className="sr-only"
              />
              {m.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function AddKnowledge({
  projects,
  storageReady,
  rules,
  onAdded,
}: {
  projects: ProjectOption[];
  storageReady: boolean;
  rules: KnowledgeOverview["rules"];
  onAdded: (source: KnowledgeSourceView) => void;
}) {
  const uid = useId();
  const [mode, setMode] = useState<Mode>("file");
  const [role, setRole] = useState<SourceRole>("reference");
  const [projectId, setProjectId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0); // bumped to clear the file picker
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [since, setSince] = useState<number | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const seconds = useElapsed(since);
  const fieldsRef = useRef<HTMLFieldSetElement>(null);

  const busy = since !== null;
  const current = MODES.find((m) => m.id === mode) ?? MODES[0];
  const problem = file ? fileProblem(file) : null;
  const rulesLeft = Math.max(0, rules.limitChars - rules.usedChars);
  const textOverRules = role === "rules" && text.trim().length > rulesLeft;
  const ready =
    mode === "file"
      ? storageReady && file !== null && problem === null
      : mode === "page"
        ? url.trim() !== ""
        : title.trim() !== "" && text.trim() !== "";

  function chooseMode(next: Mode) {
    setMode(next);
    setNotice(null);
  }

  function send(): Promise<{ source: KnowledgeSourceView }> {
    if (mode === "file") {
      const form = new FormData();
      if (file) form.append("file", file);
      form.append("role", role);
      form.append("projectId", projectId); // "" = all projects
      if (title.trim()) form.append("title", title.trim());
      if (validUntil) form.append("validUntil", validUntil);
      return uploadFile(form);
    }
    if (mode === "page") {
      return apiFetch("/api/knowledge/pages", {
        method: "POST",
        json: { url: url.trim(), role, projectId: projectId || null, title: title.trim() || undefined },
      });
    }
    return apiFetch("/api/knowledge/texts", {
      method: "POST",
      json: { title: title.trim(), text: text.trim(), role, projectId: projectId || null },
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !ready) return;
    const name = mode === "file" ? (file?.name ?? "") : mode === "page" ? url.trim() : title.trim();
    setSince(Date.now());
    setNotice({ tone: "muted", text: progress(mode, name) });
    try {
      const { source } = await send();
      onAdded(source);
      setNotice(outcome(source));
      // It's saved even when it couldn't be read, so clear the form either way; fixes happen in the list.
      setFile(null);
      setFileInputKey((k) => k + 1);
      setTitle("");
      setUrl("");
      setText("");
      setValidUntil("");
    } catch (err) {
      setNotice(
        err instanceof DuplicateUpload
          ? {
              tone: "warn",
              text: (
                <>
                  Nothing was uploaded. <bdi>{sentence(err.message)}</bdi> Reprocess or edit that document in the list below
                  instead, or choose a different project.
                </>
              ),
            }
          : { tone: "bad", text: errorText(err) },
      );
    } finally {
      flushSync(() => setSince(null));
      // The form was disabled while it worked, which drops keyboard focus; put it on the first field.
      restoreFocus(fieldsRef.current?.querySelector<HTMLElement>("input:not([type=radio]), textarea"));
    }
  }

  const rulesWarningId = `${uid}-rules-warning`;

  return (
    <Section
      title="Add knowledge"
      intro="Upload a file, add a page from your website, or write the text here. The AI can use it as soon as it's ready."
    >
      <form onSubmit={submit} className="grid gap-3">
        <fieldset ref={fieldsRef} disabled={busy} className="grid min-w-0 gap-5">
          <ModeTabs value={mode} onChange={chooseMode} />

          {mode === "file" && !storageReady ? (
            <p className="border-l-2 border-warn pl-3 text-[14px] leading-relaxed">
              File uploads need file storage, where LeadSprint keeps the original files. Connect a folder in{" "}
              <ConnectionsLink />, or add a web page or text instead.
            </p>
          ) : (
            <>
              {mode === "file" && (
                <Field
                  label="File"
                  htmlFor={`${uid}-file`}
                  help={
                    <span aria-live="polite" className={problem ? "text-bad" : ""}>
                      {problem ?? `${ACCEPTED_TEXT}, up to ${formatBytes(MAX_UPLOAD_BYTES)}.`}
                    </span>
                  }
                >
                  <input
                    key={fileInputKey}
                    id={`${uid}-file`}
                    type="file"
                    accept={ACCEPTED_EXTENSIONS.join(",")}
                    aria-invalid={problem ? true : undefined}
                    onChange={(e) => {
                      setFile(e.target.files?.[0] ?? null);
                      setNotice(null);
                    }}
                    className="block w-full text-[14px] text-muted file:mr-3 file:h-9 file:cursor-pointer file:rounded-[4px] file:border file:border-line file:bg-panel file:px-4 file:text-[14px] file:font-medium file:text-ink hover:file:border-marina disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </Field>
              )}

              {mode === "page" && (
                <Field
                  label="Page address"
                  htmlFor={`${uid}-url`}
                  help="A public page, such as a project page on your website. LeadSprint reads it now; reprocess it after the page changes."
                >
                  {/* Plain text rather than type="url": the server accepts addresses without https:// too. */}
                  <Input
                    id={`${uid}-url`}
                    type="text"
                    inputMode="url"
                    placeholder="https://"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    required
                  />
                </Field>
              )}

              <Field
                label="Title"
                htmlFor={`${uid}-title`}
                help={
                  mode === "file"
                    ? "Optional. Leave it empty to use the file's name."
                    : mode === "page"
                      ? "Optional. Leave it empty to use the page's own title."
                      : undefined
                }
              >
                <Input
                  id={`${uid}-title`}
                  dir="auto"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required={mode === "text"}
                />
              </Field>

              {mode === "text" && (
                <Field
                  label="Text"
                  htmlFor={`${uid}-text`}
                  help={`${count(text.trim().length, "character")}.`}
                >
                  <Textarea
                    id={`${uid}-text`}
                    aria-describedby={rulesWarningId}
                    aria-invalid={textOverRules || undefined}
                    dir="auto"
                    rows={8}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    required
                  />
                </Field>
              )}
              {mode === "text" && (
                // Always present (empty when fine) so the warning is announced as it appears.
                <p id={rulesWarningId} role="status" className={`-mt-3 text-[13px] leading-snug text-bad ${textOverRules ? "" : "sr-only"}`}>
                  {textOverRules &&
                    `That's ${formatNumber(text.trim().length - rulesLeft)} more characters than the rules limit allows. Shorten it or add it as reference.`}
                </p>
              )}

              <RoleChoice value={role} onChange={setRole} rulesLeft={rulesLeft} />

              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Project" htmlFor={`${uid}-project`} help="Choose All projects if it applies to every project.">
                  <ProjectSelect id={`${uid}-project`} value={projectId} onChange={setProjectId} projects={projects} />
                </Field>
                {mode === "file" && (
                  <Field
                    label="Valid until"
                    htmlFor={`${uid}-valid`}
                    help="Optional. The AI stops using it after this date, for example when an offer ends."
                  >
                    <Input id={`${uid}-valid`} type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
                  </Field>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
                <Button type="submit" disabled={!ready}>
                  {busy ? `${current.working} ${seconds} s` : current.submit}
                </Button>
              </div>
            </>
          )}
        </fieldset>
        <NoticeLine notice={notice} />
      </form>
    </Section>
  );
}
