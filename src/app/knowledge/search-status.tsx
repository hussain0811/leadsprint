import { useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui";
import { apiFetch } from "@/lib/api-client";
import type { KnowledgeOverview } from "@/lib/knowledge/types";
import {
  ConnectionsLink,
  count,
  errorText,
  formatNumber,
  NoticeLine,
  restoreFocus,
  Section,
  sentence,
  StatusLine,
  useElapsed,
  type Notice,
} from "./shared";

type EmbedResponse = { embedded: number; skipped: string | null };

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-4 sm:grid-cols-[6.5rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-[14px] font-medium leading-relaxed">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

export function SearchStatus({ overview, onEmbedded }: { overview: KnowledgeOverview; onEmbedded: () => void }) {
  const { search, rules, aiReady } = overview;
  const [since, setSince] = useState<number | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const seconds = useElapsed(since);

  async function addMeaningSearch() {
    setSince(Date.now());
    setNotice({
      tone: "muted",
      text: "Adding meaning search. Each passage goes through your embedding model, so a large library can take a few minutes.",
    });
    try {
      const res = await apiFetch<EmbedResponse>("/api/knowledge/embed", { method: "POST" });
      // `skipped` explains why nothing was added, for example that no embedding model is chosen.
      if (res.embedded === 0) {
        setNotice({ tone: "muted", text: sentence(res.skipped) || "No passages needed meaning search." });
      } else {
        const added = `Added meaning search to ${count(res.embedded, "passage")}.`;
        setNotice({ tone: "ok", text: res.skipped ? `${added} ${sentence(res.skipped)}` : added });
      }
      onEmbedded();
    } catch (err) {
      setNotice({ tone: "bad", text: errorText(err) });
    } finally {
      flushSync(() => setSince(null));
      // The button was disabled while it worked (and goes once nothing needs it), so keep focus on the result.
      restoreFocus(noticeRef.current);
    }
  }

  const model = search.embeddingModel;
  const over = rules.usedChars > rules.limitChars;
  const filled = rules.limitChars > 0 ? Math.min(100, (rules.usedChars / rules.limitChars) * 100) : 0;

  return (
    <Section
      title="Search and rules"
      intro="How the AI finds the right passages for a lead's question, and how much room your rules have left."
    >
      <dl className="divide-y divide-line border-y border-line">
        <Row label="Search">
          {search.mode === "hybrid" ? (
            <StatusLine tone="ok">
              Meaning and keyword search, using <span className="font-medium wrap-break-word">{model ?? "your embedding model"}</span>.
            </StatusLine>
          ) : model ? (
            // A model is chosen, but no passage has been embedded with it yet.
            <StatusLine tone="muted">
              Keyword search only for now.{" "}
              {search.needsEmbedding > 0 ? (
                <>
                  Add meaning search below to start using <span className="font-medium wrap-break-word">{model}</span>.
                </>
              ) : (
                <>
                  Meaning search with <span className="font-medium wrap-break-word">{model}</span> starts with your first
                  document or question.
                </>
              )}
            </StatusLine>
          ) : (
            <StatusLine tone="muted">
              Keyword search only. Add an embedding model in <ConnectionsLink /> to match meaning too.
            </StatusLine>
          )}

          {search.needsEmbedding > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 pl-4">
              <p className="text-[14px]">
                {search.needsEmbedding === 1
                  ? "1 passage doesn't have meaning search yet."
                  : `${formatNumber(search.needsEmbedding)} passages don't have meaning search yet.`}
              </p>
              <Button variant="secondary" onClick={addMeaningSearch} disabled={since !== null}>
                {since !== null ? `Adding… ${seconds} s` : "Add meaning search"}
              </Button>
            </div>
          )}
          <NoticeLine ref={noticeRef} notice={notice} reserve={false} className="mt-2 pl-4" />
        </Row>

        <Row label="Rules">
          <p className={`text-[14px] leading-relaxed ${over ? "text-bad" : ""}`}>
            Rules use {formatNumber(rules.usedChars)} of {formatNumber(rules.limitChars)} characters.
          </p>
          <div aria-hidden className="mt-2 h-1.5 max-w-sm overflow-hidden rounded-full bg-line">
            <div className={`h-full rounded-full ${over ? "bg-bad" : "bg-brass"}`} style={{ width: `${filled}%` }} />
          </div>
          <p className="mt-2 text-[13px] leading-snug text-muted">
            {over
              ? `That's ${formatNumber(rules.usedChars - rules.limitChars)} over the limit. Shorten a rules document, or change one to reference.`
              : rules.usedChars === 0
                ? "No rules yet. Add your terms and conditions, disclaimers or tone of voice as rules."
                : "Rules go with every AI reply, which is why they have a limit."}
          </p>
        </Row>

        {!aiReady && (
          <Row label="AI model">
            <StatusLine tone="muted">No AI model is connected.</StatusLine>
            <p className="mt-1 pl-4 text-[14px] leading-relaxed text-muted">
              Documents and rules still save, and you can try a question to test search. Connect a model in{" "}
              <ConnectionsLink /> for the AI to use them and to see its answers.
            </p>
          </Row>
        )}
      </dl>
    </Section>
  );
}
