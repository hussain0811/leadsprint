import type { z } from "zod";

export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

// Parses a JSON request body against a schema; on failure returns a ready-to-send 400.
export async function parseBody<T extends z.ZodType>(
  req: Request,
  schema: T,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: Response }> {
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
