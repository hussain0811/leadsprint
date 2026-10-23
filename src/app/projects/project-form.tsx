import { useId, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { Button, Field, Input, Section, Textarea, TextButton } from "@/components/ui";
import { apiFetch } from "@/lib/api-client";
import { PROJECT_STATUS_LABEL, PROJECT_STATUSES, type ProjectDetail, type ProjectFields, type ProjectStatus } from "@/lib/projects/types";
import { count, errorText, listJoin, NoticeLine, projectPath, restoreFocus, type Notice } from "./shared";

type Draft = Record<Exclude<keyof ProjectFields, "status">, string> & { status: ProjectStatus };

const TEXT_FIELDS = ["name", "community", "city", "developer", "handover", "paymentPlan", "permitNumber", "description"] as const;

function toDraft(detail: ProjectDetail | null): Draft {
  const p = detail?.project;
  return {
    name: p?.name ?? "",
    community: p?.community ?? "",
    city: p?.city ?? (p ? "" : "Dubai"),
    developer: p?.developer ?? "",
    status: p?.status ?? "off_plan",
    handover: p?.handover ?? "",
    paymentPlan: p?.paymentPlan ?? "",
    permitNumber: p?.permitNumber ?? "",
    description: p?.description ?? "",
  };
}

// What deleting the project takes with it, and what stays, for the confirmation.
function deleteWarning(detail: ProjectDetail) {
  const { related, slots } = detail;
  const booked = slots.filter((s) => s.booking).length;
  const goes = [
    related.units && count(related.units, "unit"),
    related.slots && `${count(related.slots, "viewing slot")}${booked ? ` (${booked} upcoming booked)` : ""}`,
    related.documents && count(related.documents, "knowledge document"),
    related.qaPairs && count(related.qaPairs, "question and answer", "questions and answers"),
  ].filter((x): x is string => Boolean(x));
  const stays = [related.leads && count(related.leads, "lead"), related.bookings && count(related.bookings, "booking")].filter(
    (x): x is string => Boolean(x),
  );
  return [
    `Delete “${detail.project.name}”?`,
    goes.length ? `This also deletes its ${listJoin(goes)}.` : "It has no units, slots or documents yet.",
    stays.length ? `Its ${listJoin(stays)} stay, without a project.` : "",
    "This can't be undone.",
  ]
    .filter(Boolean)
    .join(" ");
}

export function ProjectForm({
  detail,
  onSaved,
  onDeleted,
}: {
  detail: ProjectDetail | null; // null: a new project
  onSaved: (detail: ProjectDetail) => void;
  onDeleted: (id: string) => void;
}) {
  const uid = useId();
  const [draft, setDraft] = useState<Draft>(() => toDraft(detail));
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const isNew = detail === null;

  const saved = toDraft(detail);
  const dirty = isNew || (Object.keys(draft) as (keyof Draft)[]).some((k) => draft[k].trim() !== saved[k]);

  function edit<K extends keyof Draft>(field: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [field]: value }));
    setNotice(null);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !draft.name.trim()) return;
    // A new project sends everything; an edit sends only what changed.
    const body: Partial<Record<keyof Draft, string | null>> = {};
    for (const field of TEXT_FIELDS) {
      const value = draft[field].trim();
      if (isNew || value !== saved[field]) body[field] = value || null;
    }
    if (isNew || draft.status !== saved.status) body.status = draft.status;
    if (Object.keys(body).length === 0) return;

    setBusy("save");
    setNotice(null);
    try {
      const next = await apiFetch<ProjectDetail>(isNew ? "/api/projects" : projectPath(detail.project.id), {
        method: isNew ? "POST" : "PATCH",
        json: body,
      });
      onSaved(next);
      if (!isNew) {
        flushSync(() => {
          setDraft(toDraft(next));
          setBusy(null);
          setNotice({ tone: "ok", text: "Saved. The bot uses the new details from its next reply." });
        });
        restoreFocus(saveButton.current);
      }
    } catch (err) {
      flushSync(() => {
        setNotice({ tone: "bad", text: errorText(err) });
        setBusy(null);
      });
      restoreFocus(saveButton.current);
    }
  }

  async function remove() {
    if (!detail || busy) return;
    if (!window.confirm(deleteWarning(detail))) return;
    setBusy("delete");
    setNotice(null);
    try {
      await apiFetch<{ ok: true }>(projectPath(detail.project.id), { method: "DELETE" });
      onDeleted(detail.project.id);
    } catch (err) {
      flushSync(() => {
        setNotice({ tone: "bad", text: errorText(err) });
        setBusy(null);
      });
      restoreFocus(deleteButton.current);
    }
  }

  const id = (name: string) => `${uid}-${name}`;

  return (
    <Section
      title="Project details"
      intro="What the bot tells leads about the project. Leave a field blank if you'd rather it didn't say."
    >
      <form onSubmit={save} className="grid gap-4" aria-label={isNew ? "New project" : "Project details"}>
        <Field label="Project name" htmlFor={id("name")}>
          <Input
            id={id("name")}
            dir="auto"
            value={draft.name}
            onChange={(e) => edit("name", e.target.value)}
            required
            maxLength={120}
            autoFocus={isNew}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Community" htmlFor={id("community")}>
            <Input
              id={id("community")}
              dir="auto"
              placeholder="Dubai Marina"
              value={draft.community}
              onChange={(e) => edit("community", e.target.value)}
              maxLength={120}
            />
          </Field>
          <Field label="City" htmlFor={id("city")}>
            <Input id={id("city")} dir="auto" value={draft.city} onChange={(e) => edit("city", e.target.value)} maxLength={80} />
          </Field>
          <Field label="Developer" htmlFor={id("developer")}>
            <Input
              id={id("developer")}
              dir="auto"
              value={draft.developer}
              onChange={(e) => edit("developer", e.target.value)}
              maxLength={120}
            />
          </Field>
          <Field
            label="Permit number"
            htmlFor={id("permit")}
            help="The advertising permit (Trakheesi) number. The bot gives it when a lead asks."
          >
            <Input
              id={id("permit")}
              dir="auto"
              value={draft.permitNumber}
              onChange={(e) => edit("permitNumber", e.target.value)}
              maxLength={80}
            />
          </Field>
        </div>
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <fieldset className="min-w-0">
            <legend className="text-[14px] font-medium">Stage</legend>
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
              {PROJECT_STATUSES.map((status) => (
                <label key={status} className="flex min-h-6 cursor-pointer items-center gap-2.5 text-[14px]">
                  <input
                    type="radio"
                    name={id("status")}
                    value={status}
                    checked={draft.status === status}
                    onChange={() => edit("status", status)}
                    className="accent-marina"
                  />
                  {PROJECT_STATUS_LABEL[status]}
                </label>
              ))}
            </div>
          </fieldset>
          <Field label="Handover" htmlFor={id("handover")} help="For example “Q4 2027” or “Ready to move in”.">
            <Input
              id={id("handover")}
              dir="auto"
              value={draft.handover}
              onChange={(e) => edit("handover", e.target.value)}
              maxLength={120}
            />
          </Field>
        </div>
        <Field label="Payment plan" htmlFor={id("payment")} help="For example “10% on booking, 50% during construction, 40% on handover”.">
          <Textarea
            id={id("payment")}
            dir="auto"
            rows={2}
            value={draft.paymentPlan}
            onChange={(e) => edit("paymentPlan", e.target.value)}
            maxLength={1000}
          />
        </Field>
        <Field label="Description" htmlFor={id("description")}>
          <Textarea
            id={id("description")}
            dir="auto"
            rows={4}
            value={draft.description}
            onChange={(e) => edit("description", e.target.value)}
            maxLength={4000}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <Button ref={saveButton} type="submit" disabled={busy !== null || !draft.name.trim() || !dirty}>
            {busy === "save" ? "Saving…" : isNew ? "Create project" : "Save changes"}
          </Button>
          {!isNew && dirty && (
            <Button variant="secondary" onClick={() => setDraft(saved)} disabled={busy !== null}>
              Undo changes
            </Button>
          )}
          {!isNew && (
            <TextButton ref={deleteButton} tone="bad" onClick={remove} disabled={busy !== null} className="ml-auto">
              {busy === "delete" ? "Deleting…" : "Delete project"}
            </TextButton>
          )}
        </div>
        <NoticeLine notice={notice} />
      </form>
    </Section>
  );
}
