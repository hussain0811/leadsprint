import type { z } from "zod";

export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

/**
 * Refuses a request that a browser sent from another site, so a page elsewhere can't make a
 * visitor's browser change data here. Browsers label every request with Sec-Fetch-Site and send
 * Origin on POST, PATCH and DELETE; tools like curl send neither and are let through.
 * Call it first in every handler that changes data.
 */
export function crossSiteError(req: Request): Response | null {
  const refuse = () => jsonError("This request came from another site, so it was refused.", 403);
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return refuse();
  const origin = req.headers.get("origin");
  if (origin) {
    let host: string | null = null;
    try {
      host = new URL(origin).host;
    } catch {
      // "null" or a malformed origin: refused below
    }
    if (!host || host !== req.headers.get("host")) return refuse();
  }
  return null;
}

// Parses a JSON request body against a schema; on failure returns a ready-to-send 400 (or 415).
export async function parseBody<T extends z.ZodType>(
  req: Request,
  schema: T,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: Response }> {
  // Requiring the JSON type also rules out plain form posts, which browsers send cross-site freely.
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") {
    return { ok: false, response: jsonError("Send the request body as JSON (Content-Type: application/json).", 415) };
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { ok: false, response: jsonError("Send the request body as JSON.") };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, response: jsonError(parsed.error.issues[0]?.message ?? "The request isn't valid.") };
  }
  return { ok: true, data: parsed.data };
}
