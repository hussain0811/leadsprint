import type { Answering, InboxFilters, InboxItem } from "./types";

// Pure helpers for the inbox: reading filters from a URL, who answers next, previews and order.

export const MAX_SEARCH = 100;
export const PREVIEW_CHARS = 120;

function flag(value: string | null): boolean {
  return value === "1" || value === "true";
}

export function parseFilters(params: URLSearchParams): InboxFilters {
  const project = params.get("project")?.trim() ?? "";
  return {
    needsHuman: flag(params.get("needs")),
    takeover: flag(params.get("takeover")),
    projectId: project ? project.slice(0, 64) : null,
    q: (params.get("q") ?? "").trim().slice(0, MAX_SEARCH),
  };
}

/** The query string for a set of filters, leaving out the ones that are off. */
export function filtersQuery(filters: InboxFilters): string {
  const params = new URLSearchParams();
  if (filters.needsHuman) params.set("needs", "1");
  if (filters.takeover) params.set("takeover", "1");
  if (filters.projectId) params.set("project", filters.projectId);
  if (filters.q.trim()) params.set("q", filters.q.trim());
  return params.toString();
}

/** Who answers the lead's next message, from the conversation's switches and the AI connection. */
export function answeringMode(c: { humanTakeover: boolean; forceScripted: boolean; aiStopped: boolean; aiReady: boolean }): Answering {
  if (c.humanTakeover) return "person";
  if (c.forceScripted || c.aiStopped || !c.aiReady) return "scripted";
  return "ai";
}

/** One line of the last message: whitespace collapsed, cut at a word near the limit. */
export function previewText(body: string, max = PREVIEW_CHARS): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Newest activity first; ties keep a stable order by id. */
export function sortByActivity<T extends Pick<InboxItem, "id" | "lastActivityAt">>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const diff = new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime();
    return diff !== 0 ? diff : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
