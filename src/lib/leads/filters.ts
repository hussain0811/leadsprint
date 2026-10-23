import type { Score } from "@/lib/chat/types";
import { LEAD_STATUSES, SCORES, type LeadFilters, type LeadStatus } from "./types";

// Reading and writing the list filters as URL search params, shared by the page, the list API and the CSV export.

const MAX_QUERY = 100;

export const DEFAULT_FILTERS: LeadFilters = {
  score: null,
  status: null,
  projectId: null,
  needsPerson: false,
  q: "",
  sort: "newest",
  page: 1,
};

type ParamsLike = { get(name: string): string | null };

/** Unknown or malformed values fall back to "any", so an old bookmark never breaks the page. */
export function parseLeadFilters(params: ParamsLike): LeadFilters {
  const score = params.get("score");
  const status = params.get("status");
  const project = params.get("project")?.trim() ?? "";
  const page = Number.parseInt(params.get("page") ?? "", 10);
  return {
    score: SCORES.includes(score as Score) ? (score as Score) : null,
    status: LEAD_STATUSES.includes(status as LeadStatus) ? (status as LeadStatus) : null,
    projectId: project && project.length <= 64 ? project : null,
    needsPerson: params.get("needsPerson") === "1",
    q: (params.get("q") ?? "").trim().slice(0, MAX_QUERY),
    sort: params.get("sort") === "score" ? "score" : "newest",
    page: Number.isFinite(page) && page >= 1 ? Math.min(page, 10_000) : 1,
  };
}

/** Only values that differ from the defaults go in the URL. */
export function leadFiltersToSearch(f: LeadFilters, opts: { page?: boolean } = {}): string {
  const p = new URLSearchParams();
  if (f.score) p.set("score", f.score);
  if (f.status) p.set("status", f.status);
  if (f.projectId) p.set("project", f.projectId);
  if (f.needsPerson) p.set("needsPerson", "1");
  if (f.q) p.set("q", f.q);
  if (f.sort !== "newest") p.set("sort", f.sort);
  if (opts.page !== false && f.page > 1) p.set("page", String(f.page));
  return p.toString();
}

/** Digits a phone search should look for: "050 123" -> "50123", so it finds "+971 50 123 4567" too. */
export function phoneSearchDigits(q: string): string | null {
  if (!/\d/.test(q) || /[^\d\s+()-]/.test(q)) return null;
  const digits = q.replace(/\D/g, "").replace(/^0+/, "");
  return digits.length >= 3 ? digits : null;
}

export function phoneMatches(phone: string | null, digits: string): boolean {
  return phone !== null && phone.replace(/\D/g, "").includes(digits);
}

const SCORE_RANK: Record<Score, number> = { hot: 0, warm: 1, cold: 2, unknown: 3 };

export function scoreRank(score: string): number {
  return SCORE_RANK[score as Score] ?? 3;
}

/** Hottest first; newest first within a score. */
export function compareByScore(a: { score: string; createdAt: Date }, b: { score: string; createdAt: Date }): number {
  return scoreRank(a.score) - scoreRank(b.score) || b.createdAt.getTime() - a.createdAt.getTime();
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
