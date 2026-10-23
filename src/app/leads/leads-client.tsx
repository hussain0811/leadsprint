"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button, Field, Input, Select, StatusMark, Switch } from "@/components/ui";
import { apiFetch } from "@/lib/api-client";
import type { Score } from "@/lib/chat/types";
import { leadFiltersToSearch, parseLeadFilters } from "@/lib/leads/filters";
import { dubaiDateTime, KIND_LABEL, SCORE_LABEL, sourceLabel, statusLabel, STATUS_LABEL } from "@/lib/leads/present";
import { LEAD_STATUSES, PAGE_SIZE, SCORES, type LeadFilters, type LeadListResponse, type LeadRow } from "@/lib/leads/types";
import { timeAgo } from "@/lib/time";
import { errorText, LINK, Phone, ScoreMark, UserText } from "./shared";

const SEARCH_DELAY_MS = 300;

export function LeadsClient() {
  const uid = useId();
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState<LeadFilters>(() => parseLeadFilters(searchParams));
  const [query, setQuery] = useState(filters.q);
  // Each result remembers which filters it answers, so "Updating…" shows until the newest one arrives.
  const [result, setResult] = useState<{ search: string; data: LeadListResponse | null; error: string | null } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const latestLoad = useRef(0);
  const tableRef = useRef<HTMLDivElement>(null);

  const search = leadFiltersToSearch(filters);

  // Keep the URL in step so a refresh, a shared link or the back button from a lead returns to the same view.
  useEffect(() => {
    const url = search ? `?${search}` : window.location.pathname;
    window.history.replaceState(null, "", url);
  }, [search]);

  // Only the most recent request may update the page, so a slow response can't overwrite a newer one.
  useEffect(() => {
    const request = ++latestLoad.current;
    apiFetch<LeadListResponse>(`/api/leads${search ? `?${search}` : ""}`).then(
      (next) => {
        if (request === latestLoad.current) setResult({ search, data: next, error: null });
      },
      (err: unknown) => {
        if (request === latestLoad.current) setResult((r) => ({ search, data: r?.data ?? null, error: errorText(err) }));
      },
    );
  }, [search, attempt]);

  const data = result?.data ?? null;
  const error = result?.search === search ? result.error : null;
  const loading = result?.search !== search;
  const load = useCallback(() => setAttempt((n) => n + 1), []);

  // Typing searches after a short pause; any filter change starts again from page 1.
  useEffect(() => {
    const q = query.trim();
    if (q === filters.q) return;
    const timer = setTimeout(() => setFilters((f) => ({ ...f, q, page: 1 })), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query, filters.q]);

  function change(patch: Partial<LeadFilters>) {
    setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 1 }));
  }

  function goToPage(page: number) {
    change({ page });
    tableRef.current?.focus();
  }

  function clearAll() {
    setQuery("");
    setFilters(parseLeadFilters(new URLSearchParams()));
  }

  const filtered = leadFiltersToSearch({ ...filters, sort: "newest" }, { page: false }) !== "";
  const exportSearch = leadFiltersToSearch(filters, { page: false });

  return (
    <div className="mt-8">
      <form
        role="search"
        aria-label="Filter leads"
        className="grid gap-4 border-b border-line pb-6 sm:grid-cols-2 lg:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          change({ q: query.trim() });
        }}
      >
        <Field label="Search" htmlFor={`${uid}-q`} help="Name or phone number">
          <Input id={`${uid}-q`} type="search" value={query} onChange={(e) => setQuery(e.target.value)} dir="auto" autoComplete="off" />
        </Field>
        <Field label="Score" htmlFor={`${uid}-score`}>
          <Select id={`${uid}-score`} value={filters.score ?? ""} onChange={(e) => change({ score: (e.target.value || null) as Score | null })}>
            <option value="">Any score</option>
            {SCORES.map((s) => (
              <option key={s} value={s}>
                {SCORE_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status" htmlFor={`${uid}-status`}>
          <Select
            id={`${uid}-status`}
            value={filters.status ?? ""}
            onChange={(e) => change({ status: (e.target.value || null) as LeadFilters["status"] })}
          >
            <option value="">Any status</option>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Project" htmlFor={`${uid}-project`}>
          <Select id={`${uid}-project`} value={filters.projectId ?? ""} onChange={(e) => change({ projectId: e.target.value || null })}>
            <option value="">Any project</option>
            <option value="none">No project</option>
            {data?.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            {/* Keep a project from the URL selectable before the list loads. */}
            {filters.projectId && filters.projectId !== "none" && data && !data.projects.some((p) => p.id === filters.projectId) && (
              <option value={filters.projectId}>Unknown project</option>
            )}
          </Select>
        </Field>
        <Field label="Sort by" htmlFor={`${uid}-sort`}>
          <Select id={`${uid}-sort`} value={filters.sort} onChange={(e) => change({ sort: e.target.value === "score" ? "score" : "newest" })}>
            <option value="newest">Newest first</option>
            <option value="score">Score, hottest first</option>
          </Select>
        </Field>
        <div className="flex items-end pb-1.5">
          <Switch checked={filters.needsPerson} onCheckedChange={(next) => change({ needsPerson: next })}>
            Only leads that need a person
          </Switch>
        </div>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3 py-4">
        <p role="status" className="text-[14px]">
          {error ? (
            <span className="text-bad">Couldn&apos;t load leads: {error}</span>
          ) : data ? (
            <>
              {data.total === 0 ? "No leads" : `${data.total} lead${data.total === 1 ? "" : "s"}`}
              {filtered && " match these filters"}
              {loading && <span className="text-muted"> · Updating…</span>}
            </>
          ) : (
            <span className="text-muted">Loading your leads…</span>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-4">
          {filtered && (
            <button type="button" onClick={clearAll} className={`text-[14px] font-medium ${LINK}`}>
              Clear filters
            </button>
          )}
          {error && (
            <Button variant="secondary" onClick={load}>
              Try again
            </Button>
          )}
          <a
            href={`/api/leads/export${exportSearch ? `?${exportSearch}` : ""}`}
            download
            aria-disabled={!data || data.total === 0}
            className={`inline-flex h-9 items-center rounded-[4px] border border-line bg-panel px-4 text-[14px] font-medium hover:border-marina ${
              !data || data.total === 0 ? "pointer-events-none opacity-50" : ""
            }`}
          >
            Export CSV{filtered ? " (filtered)" : ""}
          </a>
        </div>
      </div>

      {data && data.total === 0 && !error && (
        <p className="max-w-[62ch] text-[15px] leading-relaxed text-muted">
          {filtered
            ? "No leads match these filters. Try a different search or clear the filters."
            : "No leads yet. They appear here when someone starts a chat; try one in the Chat tester."}{" "}
          {!filtered && (
            <Link href="/chat" className={LINK}>
              Open the Chat tester
            </Link>
          )}
        </p>
      )}

      {data && data.leads.length > 0 && (
        <div ref={tableRef} tabIndex={-1} className="overflow-x-auto border-y border-line" aria-busy={loading}>
          <table className="w-full min-w-[58rem] border-collapse text-left text-[14px]">
            <caption className="sr-only">
              Leads, {filters.sort === "score" ? "hottest first" : "newest first"}, page {data.page} of {data.pageCount}
            </caption>
            <thead>
              <tr className="border-b border-line text-[13px] text-muted">
                <th scope="col" className="py-2.5 pr-3 font-medium">Lead</th>
                <th scope="col" className="py-2.5 pr-3 font-medium">Project</th>
                <th scope="col" className="py-2.5 pr-3 font-medium">Score</th>
                <th scope="col" className="py-2.5 pr-3 font-medium">Status</th>
                <th scope="col" className="py-2.5 pr-3 font-medium">Answers</th>
                <th scope="col" className="py-2.5 pr-3 font-medium">Booking</th>
                <th scope="col" className="py-2.5 font-medium">Source and last activity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.leads.map((lead) => (
                <Row key={lead.id} lead={lead} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.pageCount > 1 && (
        <nav aria-label="Pages" className="flex flex-wrap items-center gap-4 py-5">
          <Button variant="secondary" disabled={data.page <= 1 || loading} onClick={() => goToPage(data.page - 1)}>
            Previous
          </Button>
          <p className="text-[14px] tabular-nums">
            Page {data.page} of {data.pageCount}
            <span className="text-muted">
              {" "}
              · {(data.page - 1) * PAGE_SIZE + 1}–{Math.min(data.page * PAGE_SIZE, data.total)} of {data.total}
            </span>
          </p>
          <Button variant="secondary" disabled={data.page >= data.pageCount || loading} onClick={() => goToPage(data.page + 1)}>
            Next
          </Button>
        </nav>
      )}
    </div>
  );
}

const CELL = "py-3 pr-3 align-top";

function Row({ lead }: { lead: LeadRow }) {
  const b = lead.nextBooking;
  return (
    <tr>
      <td className={CELL}>
        <Link href={`/leads/${encodeURIComponent(lead.id)}`} className="font-medium text-marina underline-offset-4 hover:underline">
          <UserText>{lead.name}</UserText>
        </Link>
        <div className="mt-0.5 text-[13px] text-muted">
          <Phone phone={lead.phone} />
        </div>
      </td>
      <td className={CELL}>{lead.projectName ? <UserText>{lead.projectName}</UserText> : <span className="text-muted">None</span>}</td>
      <td className={CELL}>
        <ScoreMark score={lead.score} />
      </td>
      <td className={CELL}>
        <div>{statusLabel(lead.status)}</div>
        {lead.needsPerson && (
          <div className="mt-1">
            <StatusMark tone="warn">
              <span className="text-[13px] font-medium text-warn">Needs a person</span>
            </StatusMark>
          </div>
        )}
      </td>
      <td className={`${CELL} max-w-[16rem]`}>
        {lead.keyAnswers ? <span className="leading-snug">{lead.keyAnswers}</span> : <span className="text-muted">No answers yet</span>}
      </td>
      <td className={`${CELL} whitespace-nowrap`}>
        {b ? (
          <>
            <div>{KIND_LABEL[b.kind] ?? b.kind}</div>
            <div className="text-[13px] text-muted">{dubaiDateTime(b.startsAt)}</div>
          </>
        ) : (
          <span className="text-muted">None</span>
        )}
      </td>
      <td className={`${CELL} pr-0`}>
        <div>{sourceLabel(lead.source)}</div>
        <div className="text-[13px] text-muted">
          <time dateTime={lead.lastActivityAt} title={new Date(lead.lastActivityAt).toLocaleString("en-GB")}>
            {timeAgo(lead.lastActivityAt)}
          </time>
        </div>
      </td>
    </tr>
  );
}
