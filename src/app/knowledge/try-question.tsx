import { useId, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { Button, Field, Input } from "@/components/ui";
import { apiFetch } from "@/lib/api-client";
import type { Passage, ProjectOption, TryQuestionResponse } from "@/lib/knowledge/types";
import {
  ConnectionsLink,
  count,
  errorText,
  formatSeconds,
  NoticeLine,
  PlaceLabel,
  ProjectSelect,
  restoreFocus,
  Section,
  sentence,
  useElapsed,
  type Notice,
} from "./shared";

type Tried = { query: string; askedAi: boolean; response: TryQuestionResponse };

function matchedBy(by: Passage["matchedBy"]) {
  const meaning = by.includes("meaning");
  const keywords = by.includes("keywords");
  if (meaning && keywords) return "Matched by meaning and keywords";
  if (meaning) return "Matched by meaning";
  if (keywords) return "Matched by keywords";
  return null;
}

export function TryQuestion({ projects, aiReady }: { projects: ProjectOption[]; aiReady: boolean }) {
  const uid = useId();
  const [question, setQuestion] = useState("");
  const [projectId, setProjectId] = useState("");
  const [wantAnswer, setWantAnswer] = useState(false);
  const [since, setSince] = useState<number | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [tried, setTried] = useState<Tried | null>(null);
  const seconds = useElapsed(since);
  const tryButton = useRef<HTMLButtonElement>(null);

  const busy = since !== null;
  const askAi = aiReady && wantAnswer;

  async function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = question.trim();
    if (!query || busy) return;
    setSince(Date.now());
    setTried(null);
    setNotice({
      tone: "muted",
      text: askAi ? "Searching, then asking the AI. An AI model on this computer can take a while." : "Searching your documents and questions.",
    });
    try {
      const response = await apiFetch<TryQuestionResponse>("/api/knowledge/try", {
        method: "POST",
        json: { query, projectId: projectId || null, answer: askAi },
      });
      const found = response.result.passages.length;
      setTried({ query, askedAi: askAi, response });
      setNotice(
        found > 0
          ? { tone: "ok", text: `Found ${count(found, "passage")}${response.answer ? " and an answer" : ""}.` }
          : { tone: "warn", text: "Nothing matched this question." },
      );
    } catch (err) {
      setNotice({ tone: "bad", text: errorText(err) });
    } finally {
      flushSync(() => setSince(null));
      restoreFocus(tryButton.current);
    }
  }

  return (
    <Section
      title="Try a question"
      intro="Ask what a lead might ask and see which passages search finds. Add the AI's answer to check what it would say."
    >
      <form onSubmit={run} className="grid gap-4">
        <Field label="Question" htmlFor={`${uid}-question`}>
          <Input id={`${uid}-question`} dir="auto" value={question} onChange={(e) => setQuestion(e.target.value)} required />
        </Field>
        <Field
          label="Project"
          htmlFor={`${uid}-project`}
          help="The project the lead is asking about. Documents for all projects are always included."
        >
          <ProjectSelect id={`${uid}-project`} value={projectId} onChange={setProjectId} projects={projects} />
        </Field>
        <div>
          <label className="inline-flex cursor-pointer items-center gap-2 text-[14px] has-[:disabled]:cursor-not-allowed has-[:disabled]:text-muted">
            <input
              type="checkbox"
              checked={askAi}
              disabled={!aiReady}
              onChange={(e) => setWantAnswer(e.target.checked)}
              aria-describedby={`${uid}-ai-help`}
              className="accent-marina"
            />
            Also get the AI&apos;s answer
          </label>
          <p id={`${uid}-ai-help`} className="mt-1 text-[13px] leading-snug text-muted">
            {aiReady ? (
              "It runs on your AI model and follows your rules, just like a reply to a lead."
            ) : (
              <>
                Connect an AI model in <ConnectionsLink /> to get answers.
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
          <Button ref={tryButton} type="submit" disabled={busy || !question.trim()}>
            {busy ? `${askAi ? "Asking…" : "Searching…"} ${seconds} s` : "Try question"}
          </Button>
        </div>
        <NoticeLine notice={notice} />
      </form>

      {tried && <Results tried={tried} />}
    </Section>
  );
}

function Results({ tried }: { tried: Tried }) {
  const { query, askedAi, response } = tried;
  const { passages, mode } = response.result;

  return (
    <div className="mt-4 grid gap-8">
      {askedAi && (
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <h3 className="text-[15px] font-semibold">AI answer</h3>
            {response.answer && <p className="text-[13px] text-muted">Took {formatSeconds(response.answer.ms)}</p>}
          </div>
          <p className="text-[13px] text-muted">Written from the passages below, following your rules.</p>
          {response.answer ? (
            <p
              dir="auto"
              className="mt-2 whitespace-pre-wrap border-l-2 border-marina pl-4 text-[15px] leading-relaxed wrap-break-word"
            >
              {response.answer.text}
            </p>
          ) : response.answerError ? (
            <p className="mt-1 text-[14px] leading-relaxed text-bad">
              The AI couldn&apos;t answer. <bdi>{sentence(response.answerError)}</bdi>
            </p>
          ) : (
            <p className="mt-1 text-[14px] leading-relaxed text-muted">No answer came back.</p>
          )}
        </div>
      )}

      <div>
        <h3 className="text-[15px] font-semibold">Passages found</h3>
        <p className="text-[13px] text-muted">
          {mode === "hybrid"
            ? "With meaning and keyword search."
            : "With keyword search."}
        </p>
        {passages.length === 0 ? (
          <p className="mt-3 text-[14px] leading-relaxed">
            No passages matched “<bdi>{query}</bdi>”. Add a document or a question and answer that covers it, then try
            again.
          </p>
        ) : (
          <ol className="mt-3 divide-y divide-line border-y border-line">
            {passages.map((passage) => {
              const how = matchedBy(passage.matchedBy);
              return (
                <li key={`${passage.origin}-${passage.id}`} className="py-3.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                    <p className="min-w-0 font-medium leading-snug wrap-break-word">
                      <span dir="auto">{passage.title}</span>
                    </p>
                    {how && <p className="text-[13px] text-muted">{how}</p>}
                  </div>
                  <p className="text-[13px] text-muted">
                    {passage.origin === "qa" ? (
                      "Question and answer"
                    ) : passage.page !== null || passage.heading ? (
                      <PlaceLabel page={passage.page} heading={passage.heading} />
                    ) : (
                      "Document"
                    )}
                  </p>
                  <p dir="auto" className="mt-1.5 whitespace-pre-wrap text-[14px] leading-relaxed wrap-break-word">
                    {passage.text}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
