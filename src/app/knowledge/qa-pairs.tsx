import { useId, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { Button, Field, Input, Textarea, TextButton } from "@/components/ui";
import { apiFetch } from "@/lib/api-client";
import type { ProjectOption, QaPairView } from "@/lib/knowledge/types";
import { timeAgo } from "@/lib/time";
import { count, errorText, NoticeLine, ProjectSelect, restoreFocus, Section, type Notice } from "./shared";

function qaPath(id: string) {
  return `/api/knowledge/qa/${encodeURIComponent(id)}`;
}

export function QaPairs({
  pairs,
  projects,
  meaningSearch,
  onSaved,
  onDeleted,
}: {
  pairs: QaPairView[];
  projects: ProjectOption[];
  meaningSearch: boolean;
  onSaved: (qaPair: QaPairView) => void;
  onDeleted: (id: string) => void;
}) {
  const uid = useId();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [projectId, setProjectId] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [listNotice, setListNotice] = useState<Notice>(null);
  const listNoticeRef = useRef<HTMLParagraphElement>(null);
  const questionRef = useRef<HTMLInputElement>(null);
  const ready = question.trim() !== "" && answer.trim() !== "";

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !ready) return;
    setSaving(true);
    setNotice(null);
    try {
      const res = await apiFetch<{ qaPair: QaPairView }>("/api/knowledge/qa", {
        method: "POST",
        json: { question: question.trim(), answer: answer.trim(), projectId: projectId || null },
      });
      onSaved(res.qaPair);
      setQuestion("");
      setAnswer("");
      setNotice({ tone: "ok", text: "Added. It's in the list below." });
    } catch (err) {
      setNotice({ tone: "bad", text: errorText(err) });
    } finally {
      flushSync(() => setSaving(false));
      // The button was disabled while saving, which drops keyboard focus; start the next question.
      restoreFocus(questionRef.current);
    }
  }

  function deleted(qa: QaPairView) {
    onDeleted(qa.id);
    setNotice(null); // "Added. It's in the list below." may no longer be true
    setListNotice({
      tone: "ok",
      text: (
        <>
          Deleted “<bdi>{qa.question}</bdi>”.
        </>
      ),
    });
    // The row and its buttons are gone, so keep keyboard focus here rather than losing it to the page.
    listNoticeRef.current?.focus();
  }

  return (
    <Section
      title="Questions and answers"
      intro="Exact answers to questions leads often ask, like handover dates or service charges. They're searched along with your documents."
      aside={pairs.length > 0 && <p className="text-[14px]">{count(pairs.length, "question")}</p>}
    >
      <form onSubmit={add} className="grid gap-4">
        <Field label="Question" htmlFor={`${uid}-question`}>
          <Input
            ref={questionRef}
            id={`${uid}-question`}
            dir="auto"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            required
          />
        </Field>
        <Field label="Answer" htmlFor={`${uid}-answer`}>
          <Textarea id={`${uid}-answer`} dir="auto" rows={3} value={answer} onChange={(e) => setAnswer(e.target.value)} required />
        </Field>
        <div className="grid items-end gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Field label="Project" htmlFor={`${uid}-project`}>
            <ProjectSelect id={`${uid}-project`} value={projectId} onChange={setProjectId} projects={projects} />
          </Field>
          <Button type="submit" disabled={saving || !ready}>
            {saving ? "Adding…" : "Add question"}
          </Button>
        </div>
        <NoticeLine notice={notice} />
      </form>

      <NoticeLine ref={listNoticeRef} notice={listNotice} reserve={false} className={listNotice ? "mt-3" : ""} />
      {pairs.length === 0 ? (
        <p className="mt-5 text-[15px] leading-relaxed text-muted">
          No questions yet. Start with the ones your team answers every day.
        </p>
      ) : (
        <ul className="mt-5 divide-y divide-line border-y border-line" aria-label="Questions and answers">
          {pairs.map((qa) => (
            <QaRow key={qa.id} qa={qa} projects={projects} meaningSearch={meaningSearch} onSaved={onSaved} onDeleted={deleted} />
          ))}
        </ul>
      )}
    </Section>
  );
}

type Draft = { question: string; answer: string; projectId: string };

function QaRow({
  qa,
  projects,
  meaningSearch,
  onSaved,
  onDeleted,
}: {
  qa: QaPairView;
  projects: ProjectOption[];
  meaningSearch: boolean;
  onSaved: (qaPair: QaPairView) => void;
  onDeleted: (qa: QaPairView) => void;
}) {
  const uid = useId();
  const editButton = useRef<HTMLButtonElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  function startEdit() {
    setDraft({ question: qa.question, answer: qa.answer, projectId: qa.projectId ?? "" });
    setNotice(null);
  }

  // Close the editor, then put focus back on the Edit button it replaced.
  function stopEdit(message?: string) {
    flushSync(() => {
      setDraft(null);
      setBusy(null);
      if (message) setNotice({ tone: "ok", text: message });
    });
    editButton.current?.focus();
  }

  function edit(field: keyof Draft, value: string) {
    setDraft((d) => d && { ...d, [field]: value });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || busy) return;
    const changes: { question?: string; answer?: string; projectId?: string | null } = {};
    if (draft.question.trim() !== qa.question) changes.question = draft.question.trim();
    if (draft.answer.trim() !== qa.answer) changes.answer = draft.answer.trim();
    if ((draft.projectId || null) !== qa.projectId) changes.projectId = draft.projectId || null;
    if (Object.keys(changes).length === 0) {
      stopEdit();
      return;
    }
    setBusy("save");
    setNotice(null);
    try {
      const res = await apiFetch<{ qaPair: QaPairView }>(qaPath(qa.id), { method: "PATCH", json: changes });
      onSaved(res.qaPair);
      stopEdit("Saved.");
    } catch (err) {
      flushSync(() => {
        setNotice({ tone: "bad", text: errorText(err) });
        setBusy(null);
      });
      restoreFocus(saveButton.current);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete the question “${qa.question}”? This can't be undone.`)) return;
    setBusy("delete");
    setNotice(null);
    try {
      await apiFetch<{ ok: true }>(qaPath(qa.id), { method: "DELETE" });
      onDeleted(qa);
    } catch (err) {
      flushSync(() => {
        setNotice({ tone: "bad", text: errorText(err) });
        setBusy(null);
      });
      restoreFocus(deleteButton.current);
    }
  }

  return (
    <li className="py-4">
      {draft ? (
        <form onSubmit={save} aria-label="Edit question and answer" className="grid gap-4">
          <Field label="Question" htmlFor={`${uid}-question`}>
            <Input
              id={`${uid}-question`}
              dir="auto"
              value={draft.question}
              onChange={(e) => edit("question", e.target.value)}
              required
              autoFocus
            />
          </Field>
          <Field label="Answer" htmlFor={`${uid}-answer`}>
            <Textarea
              id={`${uid}-answer`}
              dir="auto"
              rows={3}
              value={draft.answer}
              onChange={(e) => edit("answer", e.target.value)}
              required
            />
          </Field>
          <Field label="Project" htmlFor={`${uid}-project`}>
            <ProjectSelect
              id={`${uid}-project`}
              value={draft.projectId}
              onChange={(value) => edit("projectId", value)}
              projects={projects}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              ref={saveButton}
              type="submit"
              disabled={busy !== null || !draft.question.trim() || !draft.answer.trim()}
            >
              {busy === "save" ? "Saving…" : "Save changes"}
            </Button>
            <Button variant="secondary" onClick={() => stopEdit()} disabled={busy !== null}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <>
          <p dir="auto" className="font-medium leading-snug wrap-break-word">
            {qa.question}
          </p>
          <p dir="auto" className="mt-1 whitespace-pre-wrap text-[14px] leading-relaxed wrap-break-word">
            {qa.answer}
          </p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
            For {qa.projectId ? <bdi>{qa.projectName ?? "one project"}</bdi> : "all projects"}. Updated {timeAgo(qa.updatedAt)}.
            {meaningSearch && !qa.embedded && " No meaning search yet."}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1">
            <TextButton ref={editButton} onClick={startEdit} disabled={busy !== null}>
              Edit
            </TextButton>
            <TextButton ref={deleteButton} tone="bad" onClick={remove} disabled={busy !== null}>
              {busy === "delete" ? "Deleting…" : "Delete"}
            </TextButton>
          </div>
        </>
      )}
      {/* One live region for both modes, so "Saved." is announced after the editor closes. */}
      <NoticeLine notice={notice} reserve={false} className={notice ? "mt-2" : ""} />
    </li>
  );
}
