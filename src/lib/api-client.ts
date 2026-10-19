// Browser-side helpers for calling the app's API routes.

export async function apiFetch<T>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(url, {
    ...rest,
    headers: json === undefined ? headers : { "Content-Type": "application/json", ...headers },
    body: json === undefined ? rest.body : JSON.stringify(json),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `The request failed (status ${res.status}).`);
  return body as T;
}

// Lets the sidebar refresh its connection status after a save or test.
export const CONNECTIONS_CHANGED = "leadsprint:connections-changed";

export function announceConnectionsChanged() {
  window.dispatchEvent(new Event(CONNECTIONS_CHANGED));
}
