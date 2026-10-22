"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { apiFetch } from "@/lib/api-client";
import type { KnowledgeOverview, KnowledgeSourceView, QaPairView } from "@/lib/knowledge/types";
import { AddKnowledge } from "./add-knowledge";
import { Documents } from "./documents";
import { QaPairs } from "./qa-pairs";
import { SearchStatus } from "./search-status";
import { errorText, isStuck } from "./shared";
import { TryQuestion } from "./try-question";

// While a document is still processing (for example an upload started in another tab), check again this often.
const PROCESSING_POLL_MS = 3000;

function upsert<T extends { id: string }>(list: T[], item: T) {
  return list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [item, ...list];
}

export function KnowledgeClient() {
  const [data, setData] = useState<KnowledgeOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latestLoad = useRef(0);

  // Reloads the overview. Only the most recent request may update the page, so a slow
  // response can't overwrite a newer one.
  const reload = useCallback(() => {
    const request = ++latestLoad.current;
    apiFetch<KnowledgeOverview>("/api/knowledge").then(
      (next) => {
        if (request !== latestLoad.current) return;
        setData(next);
        setError(null);
      },
      (err: unknown) => {
        if (request === latestLoad.current) setError(errorText(err));
      },
    );
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // Poll only for runs that may still finish; one stuck for over 5 minutes waits for a reprocess.
  const processing = data?.sources.some((s) => s.status === "processing" && !isStuck(s)) ?? false;
  useEffect(() => {
    if (!processing) return;
    const timer = setTimeout(reload, PROCESSING_POLL_MS);
    return () => clearTimeout(timer);
  }, [processing, data, reload]);

  // Each change shows straight away, then a reload brings the totals (rules size, search status) up to date.
  const saveSource = useCallback(
    (source: KnowledgeSourceView) => {
      setData((d) => d && { ...d, sources: upsert(d.sources, source) });
      reload();
    },
    [reload],
  );
  const dropSource = useCallback(
    (id: string) => {
      setData((d) => d && { ...d, sources: d.sources.filter((s) => s.id !== id) });
      reload();
    },
    [reload],
  );
  const saveQa = useCallback(
    (qaPair: QaPairView) => {
      setData((d) => d && { ...d, qaPairs: upsert(d.qaPairs, qaPair) });
      reload();
    },
    [reload],
  );
  const dropQa = useCallback(
    (id: string) => {
      setData((d) => d && { ...d, qaPairs: d.qaPairs.filter((q) => q.id !== id) });
      reload();
    },
    [reload],
  );

  if (!data) {
    if (!error) return <p className="mt-8 text-muted">Loading your knowledge base…</p>;
    return (
      <div className="mt-8 grid justify-items-start gap-3">
        <p className="text-bad">Couldn&apos;t load your knowledge base: {error}</p>
        <Button variant="secondary" onClick={reload}>
          Try again
        </Button>
      </div>
    );
  }

  const meaningSearch = data.search.mode === "hybrid" || data.search.embeddingModel !== null;

  return (
    <div>
      <p role="status" className={error ? "mt-6 text-[14px] text-bad" : "sr-only"}>
        {error && `Couldn't refresh this page: ${error}`}
      </p>
      <SearchStatus overview={data} onEmbedded={reload} />
      <AddKnowledge projects={data.projects} storageReady={data.storageReady} rules={data.rules} onAdded={saveSource} />
      <Documents
        sources={data.sources}
        projects={data.projects}
        meaningSearch={meaningSearch}
        onSaved={saveSource}
        onDeleted={dropSource}
      />
      <QaPairs pairs={data.qaPairs} projects={data.projects} meaningSearch={meaningSearch} onSaved={saveQa} onDeleted={dropQa} />
      <TryQuestion projects={data.projects} aiReady={data.aiReady} />
    </div>
  );
}
