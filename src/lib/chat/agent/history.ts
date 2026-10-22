import type OpenAI from "openai";

// The provider transcript (AiMessage rows) is append-only: each row keeps the message exactly as
// sent or received. These helpers turn rows back into request messages; no database here.

export type ProviderMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
export type StoredRow = { seq: number; role: string; raw: string };

type RawToolCall = { id?: unknown; type?: unknown; function?: { name?: unknown; arguments?: unknown } };

/**
 * Rebuilds the request messages from stored rows in seq order. Assistant replies are stored with
 * every field the provider returned; only the fields a request accepts are passed back, unchanged.
 * Unreadable rows are skipped rather than failing the turn.
 */
export function rebuildHistory(rows: StoredRow[]): ProviderMessage[] {
  const messages: ProviderMessage[] = [];
  for (const row of [...rows].sort((a, b) => a.seq - b.seq)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.raw);
    } catch {
      continue;
    }
    const message = toRequestMessage(parsed);
    if (message) messages.push(message);
  }
  return messages;
}

/** The request form of a stored or just-received message; null when it isn't one. */
export function toRequestMessage(value: unknown): ProviderMessage | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const content = raw.content;
  switch (raw.role) {
    case "user":
      return typeof content === "string" ? { role: "user", content } : null;
    case "system":
      return typeof content === "string" ? { role: "system", content } : null;
    case "tool":
      return typeof content === "string" && typeof raw.tool_call_id === "string"
        ? { role: "tool", tool_call_id: raw.tool_call_id, content }
        : null;
    case "assistant": {
      const calls = Array.isArray(raw.tool_calls) ? (raw.tool_calls as RawToolCall[]) : [];
      const toolCalls = calls
        .filter((c) => typeof c.id === "string" && c.function && typeof c.function.name === "string")
        .map((c) => ({
          id: c.id as string,
          type: "function" as const,
          function: { name: c.function!.name as string, arguments: typeof c.function!.arguments === "string" ? c.function!.arguments : "" },
        }));
      const message: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
        role: "assistant",
        content: typeof content === "string" ? content : null,
      };
      if (toolCalls.length) message.tool_calls = toolCalls;
      return message;
    }
    default:
      return null;
  }
}

/**
 * Tool results for calls that have none (a turn that died mid-way). Providers reject a history with
 * unanswered tool calls, so these are appended before the next user message.
 */
export function missingToolResults(messages: ProviderMessage[]): ProviderMessage[] {
  const answered = new Set(messages.flatMap((m) => (m.role === "tool" ? [m.tool_call_id] : [])));
  const missing: ProviderMessage[] = [];
  for (const m of messages) {
    if (m.role !== "assistant" || !m.tool_calls) continue;
    for (const call of m.tool_calls) {
      if (!answered.has(call.id)) {
        missing.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: "This call was interrupted and did not run." }) });
      }
    }
  }
  return missing;
}

/** Text of every user message, oldest first (notes from LeadSprint travel in these). */
export function userContents(messages: ProviderMessage[]): string[] {
  return messages.flatMap((m) => (m.role === "user" && typeof m.content === "string" ? [m.content] : []));
}

/** The last text the assistant sent, for the topic check's context. */
export function lastAssistantText(messages: ProviderMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "assistant" && typeof m.content === "string" && m.content.trim()) return m.content;
  }
  return null;
}

/** Contents of every tool result in the history. */
export function toolResultContents(messages: ProviderMessage[]): string[] {
  return messages.flatMap((m) => (m.role === "tool" && typeof m.content === "string" ? [m.content] : []));
}

/** Serialises a message for an AiMessage row: the object exactly as sent or received. */
export function toRow<T extends { role: string }>(message: T): { role: string; raw: string } {
  return { role: message.role, raw: JSON.stringify(message) };
}
