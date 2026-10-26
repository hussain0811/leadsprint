"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button, NoticeLine, Section, StatusMark, Textarea, type Notice } from "@/components/ui";
import { apiFetch } from "@/lib/api-client";
import { WA_LIMITS, type FlowDefinition, type FlowStep, type Localized } from "@/lib/chat/types";

type SaveError = { message: string; problems: string[] };

function errorText(err: unknown) {
  if (err instanceof TypeError && /fetch|network|load failed/i.test(err.message)) {
    return "Couldn't reach LeadSprint. Check the app is still running, then try again.";
  }
  return err instanceof Error ? err.message : String(err);
}

function pretty(definition: unknown) {
  return JSON.stringify(definition, null, 2);
}

// PUT returns the plain list of problems when the flow isn't valid, so read the body ourselves
// rather than through apiFetch, which keeps only the first message.
async function saveFlow(definition: unknown): Promise<{ ok: true; definition: FlowDefinition } | { ok: false; error: SaveError }> {
  const res = await fetch("/api/flows", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ definition }),
  });
  const body = await res.json().catch(() => null);
  if (res.ok && body?.definition) return { ok: true, definition: body.definition as FlowDefinition };
  const list = [body?.problems, body?.errors, body?.issues].find(Array.isArray) as unknown[] | undefined;
  const problems = (list ?? []).map((p) => (typeof p === "string" ? p : (p as { message?: string })?.message ?? JSON.stringify(p)));
  return {
    ok: false,
    error: { message: body?.error ?? `The flow wasn't saved (status ${res.status}).`, problems },
  };
}

/* ---------- A loose check that a parsed draft can be previewed (the server does the real validation) ---------- */

function isLocalized(value: unknown): value is Localized {
  return typeof value === "object" && value !== null && typeof (value as Localized).en === "string" && typeof (value as Localized).ar === "string";
}

function previewable(value: unknown): value is FlowDefinition {
  if (typeof value !== "object" || value === null) return false;
  const def = value as FlowDefinition;
  if (!isLocalized(def.greeting) || !isLocalized(def.done) || !isLocalized(def.handoff) || !Array.isArray(def.steps)) return false;
  return def.steps.every(
    (step) =>
      typeof step === "object" &&
      step !== null &&
      typeof step.id === "string" &&
      isLocalized(step.ask) &&
      Array.isArray(step.options) &&
      step.options.every((o) => typeof o === "object" && o !== null && typeof o.id === "string" && isLocalized(o.title)),
  );
}

export function FlowsClient() {
  const [saved, setSaved] = useState<FlowDefinition | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<{ definition: FlowDefinition }>("/api/flows").then(
      (res) => setSaved(res.definition),
      (err: unknown) => setLoadError(errorText(err)),
    );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!saved) {
    if (!loadError) return <p className="mt-8 text-muted">Loading the flow…</p>;
    return (
      <div className="mt-8 grid justify-items-start gap-3">
        <p className="text-bad">Couldn&apos;t load the flow: {loadError}</p>
        <Button
          variant="secondary"
          onClick={() => {
            setLoadError(null);
            load();
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

  return <FlowEditor saved={saved} onSaved={setSaved} />;
}

function FlowEditor({ saved, onSaved }: { saved: FlowDefinition; onSaved: (definition: FlowDefinition) => void }) {
  const uid = useId();
  const savedText = useMemo(() => pretty(saved), [saved]);
  const [draft, setDraft] = useState(savedText);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const dirty = draft !== savedText;

  const parsed = useMemo((): { ok: true; value: unknown } | { ok: false; message: string } => {
    try {
      return { ok: true, value: JSON.parse(draft) };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }, [draft]);

  const draftPreview = dirty && parsed.ok && previewable(parsed.value) ? parsed.value : null;
  const shown = draftPreview ?? saved;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !dirty) return;
    if (!parsed.ok) {
      setProblems([]);
      setNotice({ tone: "bad", text: `This isn't valid JSON yet: ${parsed.message}` });
      textRef.current?.focus();
      return;
    }
    setSaving(true);
    setNotice(null);
    setProblems([]);
    try {
      const res = await saveFlow(parsed.value);
      if (res.ok) {
        onSaved(res.definition);
        setDraft(pretty(res.definition));
        setNotice({ tone: "ok", text: "Saved. New conversations use this flow." });
        return;
      }
      setProblems(res.error.problems);
      const n = res.error.problems.length;
      setNotice({
        tone: "bad",
        text: n > 0 ? `Not saved. Fix ${n === 1 ? "this problem" : `these ${n} problems`}:` : `Not saved: ${res.error.message}`,
      });
      textRef.current?.focus();
    } catch (err) {
      setNotice({ tone: "bad", text: `Not saved: ${errorText(err)}` });
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    setDraft(savedText);
    setProblems([]);
    setNotice({ tone: "ok", text: "Changes discarded." });
  }

  function format() {
    if (!parsed.ok) {
      setNotice({ tone: "bad", text: `Can't tidy it: this isn't valid JSON yet. ${parsed.message}` });
      return;
    }
    setDraft(pretty(parsed.value));
    setNotice(null);
  }

  const problemsId = `${uid}-problems`;

  return (
    <div>
      <Section
        title="Preview"
        intro="Each question as the lead sees it, in English and Arabic, with the options they can tap."
        aside={
          draftPreview ? (
            <StatusMark tone="warn">Showing your unsaved changes</StatusMark>
          ) : dirty ? (
            <StatusMark tone="muted">Showing the saved flow: your changes can&apos;t be previewed yet</StatusMark>
          ) : null
        }
      >
        <FlowPreview flow={shown} />
      </Section>

      <Section
        title="Edit as JSON"
        intro={
          <>
            Change questions, options and where each answer leads. Each step saves the chosen option&apos;s <code>value</code> into its{" "}
            <code>field</code>. WhatsApp allows {WA_LIMITS.buttons} buttons of up to {WA_LIMITS.buttonTitle} characters, and lists of{" "}
            {WA_LIMITS.listRows} rows of up to {WA_LIMITS.rowTitle} characters.
          </>
        }
      >
        <form onSubmit={save} className="grid gap-4">
          <div className="grid gap-1.5">
            <label htmlFor={`${uid}-json`} className="text-[14px] font-medium">
              Flow definition
            </label>
            <Textarea
              id={`${uid}-json`}
              ref={textRef}
              rows={26}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              aria-invalid={!parsed.ok || problems.length > 0 ? true : undefined}
              aria-describedby={problems.length > 0 ? problemsId : undefined}
              className="font-mono text-[13px] leading-snug"
              onKeyDown={(e) => {
                if (e.key === "s" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <p className="text-[13px] text-muted">
              {parsed.ok ? "Valid JSON." : `Not valid JSON yet: ${parsed.message}`} Ctrl+S saves.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={saving || !dirty}>
              {saving ? "Saving…" : "Save flow"}
            </Button>
            <Button variant="secondary" onClick={format} disabled={saving}>
              Tidy JSON
            </Button>
            {dirty && (
              <Button variant="danger" className="ml-auto" onClick={discard} disabled={saving}>
                Discard changes
              </Button>
            )}
          </div>

          <div>
            <NoticeLine notice={notice} />
            {problems.length > 0 && (
              <ul id={problemsId} className="mt-1 grid list-disc gap-1 pl-5 text-[14px] leading-relaxed text-bad">
                {problems.map((p) => (
                  <li key={p}>
                    <bdi>{p}</bdi>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </form>
      </Section>
    </div>
  );
}

/* ---------- Readable preview ---------- */

// The step id that means "the flow ends" (FLOW_END in src/lib/chat/flow.ts, which is server code).
const FLOW_END = "done";

const FIELD_TEXT: Record<string, string> = {
  intent: "whether they want to buy or rent",
  purpose: "whether it's to live in or invest",
  budgetMin: "their budget",
  budgetMax: "their budget",
  propertyType: "the property type",
  bedrooms: "the number of bedrooms",
  payment: "cash or mortgage",
  timeline: "when they want to move",
  area: "the area",
  notes: "a note",
  language: "their language",
  booking: "a viewing or call",
};

const STYLE_TEXT: Record<FlowStep["style"], string> = {
  buttons: "Reply buttons",
  list: "List menu",
  text: "Typed answer",
};

// Texts may use {org} and {project}; the bot fills them in. Show them as plain words here.
const PLACEHOLDERS: Record<"en" | "ar", Record<string, string>> = {
  en: { "{org}": "your company name", "{project}": "the project name" },
  ar: { "{org}": "اسم شركتك", "{project}": "اسم المشروع" },
};

function Filled({ text, lang }: { text: string; lang: "en" | "ar" }) {
  const parts = text.split(/(\{org\}|\{project\})/);
  return (
    <>
      {parts.map((part, i) =>
        PLACEHOLDERS[lang][part] ? (
          <span key={i} className="rounded-[3px] bg-brass/15 px-1 text-brass">
            {PLACEHOLDERS[lang][part]}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

function Bilingual({ text }: { text: Localized }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 sm:gap-6">
      <p className="whitespace-pre-wrap text-[14px] leading-relaxed" lang="en">
        {text.en ? <Filled text={text.en} lang="en" /> : <span className="text-muted">No English text</span>}
      </p>
      <p className="whitespace-pre-wrap text-[15px] leading-relaxed" lang="ar" dir="rtl">
        {text.ar ? <Filled text={text.ar} lang="ar" /> : <span className="text-muted">لا يوجد نص عربي</span>}
      </p>
    </div>
  );
}

function Message({ label, text }: { label: string; text: Localized }) {
  return (
    <div className="py-4">
      <p className="mb-1.5 text-[13px] font-medium text-muted">{label}</p>
      <Bilingual text={text} />
    </div>
  );
}

function shortQuestion(step: FlowStep) {
  const text = step.ask.en.replace(/\{org\}/g, "your company").replace(/\{project\}/g, "the project").trim();
  return text.length > 60 ? `${text.slice(0, 57).trimEnd()}…` : text;
}

// Where an answer leads, in plain words: "the next question", a named question, or the end of the flow.
function whereTo(flow: FlowDefinition, from: FlowStep, id: string | undefined): ReactNode {
  if (!id || id === FLOW_END) return "the flow ends";
  const index = flow.steps.findIndex((s) => s.id === id);
  if (index === -1) return <span className="text-bad">a question that doesn&apos;t exist (“{id}”)</span>;
  const label = flow.steps[flow.steps.indexOf(from) + 1]?.id === id ? "the next question" : `“${shortQuestion(flow.steps[index])}”`;
  return (
    <a href={`#step-${encodeURIComponent(id)}`} className="text-marina underline underline-offset-2">
      {label}
    </a>
  );
}

// "Only for buyers: renters and people just browsing skip it."
function whenText(flow: FlowDefinition, when: NonNullable<FlowStep["when"]>) {
  if (when.field === "intent") {
    if (when.equals === "buy") return "Only for buyers: renters and people just browsing skip it.";
    if (when.equals === "rent") return "Only for renters: buyers and people just browsing skip it.";
  }
  const source = flow.steps.find((s) => s.field === when.field);
  const option = source?.options.find((o) => o.value === when.equals);
  const answer = option ? option.title.en : String(when.equals);
  return source
    ? `Only asked if the lead answered “${answer}” to “${shortQuestion(source)}”; everyone else skips it.`
    : `Only asked when ${FIELD_TEXT[when.field] ?? when.field} is “${answer}”; everyone else skips it.`;
}

function OptionTitle({ text, limit }: { text: string; limit: number | null }) {
  const over = limit !== null && [...text].length > limit;
  return (
    <>
      <bdi>{text}</bdi>
      {over && <span className="block text-[12px] text-warn">Over {limit} characters</span>}
    </>
  );
}

function FlowPreview({ flow }: { flow: FlowDefinition }) {
  return (
    <div className="divide-y divide-line border-y border-line">
      <Message label="Greeting" text={flow.greeting} />
      <ol className="divide-y divide-line">
        {flow.steps.map((step, i) => (
          <StepPreview key={`${step.id}-${i}`} flow={flow} step={step} number={i + 1} />
        ))}
        {flow.steps.length === 0 && <li className="py-4 text-[14px] text-muted">No questions yet.</li>}
      </ol>
      <Message label="When the flow is done" text={flow.done} />
      <Message label="When the bot passes the lead to a person" text={flow.handoff} />
    </div>
  );
}

function StepPreview({ flow, step, number }: { flow: FlowDefinition; step: FlowStep; number: number }) {
  const limit = step.style === "buttons" ? WA_LIMITS.buttonTitle : step.style === "list" ? WA_LIMITS.rowTitle : null;
  const maxOptions = step.style === "buttons" ? WA_LIMITS.buttons : step.style === "list" ? WA_LIMITS.listRows : null;
  const field = step.field ? (FIELD_TEXT[step.field] ?? step.field) : null;

  return (
    <li id={`step-${encodeURIComponent(step.id)}`} className="scroll-mt-6 py-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-[15px] font-semibold">Question {number}</h3>
        {flow.start === step.id && <span className="text-[13px] font-medium text-brass">Asked first</span>}
        <span className="ml-auto font-mono text-[12px] text-muted" title="This question's id in the JSON below">
          id: {step.id}
        </span>
      </div>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">
        {STYLE_TEXT[step.style] ?? step.style}. {field ? `Saves ${field}.` : "Doesn't save an answer."}
        {step.when && <> {whenText(flow, step.when)}</>} Then {whereTo(flow, step, step.next)}.
      </p>

      <div className="mt-3">
        <Bilingual text={step.ask} />
      </div>

      {step.options.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-left text-[14px]">
            <caption className="sr-only">Options for question {number}</caption>
            <thead>
              <tr className="border-b border-line text-[13px] text-muted">
                <th scope="col" className="py-1.5 pr-3 font-medium">
                  English
                </th>
                <th scope="col" className="py-1.5 pr-3 font-medium">
                  Arabic
                </th>
                <th scope="col" className="py-1.5 pr-3 font-medium">
                  Saves
                </th>
                <th scope="col" className="py-1.5 font-medium">
                  Then
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {step.options.map((option, i) => (
                <tr key={`${option.id}-${i}`} className="align-top">
                  <td className="py-1.5 pr-3">
                    <OptionTitle text={option.title.en} limit={limit} />
                  </td>
                  <td className="py-1.5 pr-3" lang="ar" dir="rtl">
                    <OptionTitle text={option.title.ar} limit={limit} />
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-[13px]">{option.value === null ? "nothing" : String(option.value)}</td>
                  <td className="py-1.5 text-[13px]">{whereTo(flow, step, option.next ?? step.next)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {maxOptions !== null && step.options.length > maxOptions && (
        <p className="mt-2 text-[13px] text-warn">
          {step.options.length} options: WhatsApp allows at most {maxOptions} {step.style === "buttons" ? "buttons" : "list rows"}.
        </p>
      )}
    </li>
  );
}
