import OpenAI from "openai";

// One client shape for every OpenAI-compatible server (LM Studio, Ollama, OpenAI, Gemini, OpenRouter, Groq...).
export function createAiClient(opts: { baseUrl: string; apiKey?: string | null; timeoutMs?: number }) {
  return new OpenAI({
    baseURL: opts.baseUrl,
    // Local servers ignore the key, but the SDK always sends one.
    apiKey: opts.apiKey || "not-needed",
    timeout: opts.timeoutMs ?? 120_000,
    maxRetries: 0,
  });
}

export async function listModels(client: OpenAI) {
  const ids: string[] = [];
  for await (const model of client.models.list()) ids.push(model.id);
  ids.sort((a, b) => a.localeCompare(b));
  const isEmbedding = (id: string) => /embed/i.test(id);
  return { chat: ids.filter((id) => !isEmbedding(id)), embedding: ids.filter(isEmbedding) };
}

// Some models put their reasoning inside <think> tags in the reply itself; leads must never see it.
export function visibleText(content: string | null | undefined): string {
  if (!content) return "";
  return content
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^[\s\S]*<\/think>/i, "")
    .replace(/<think>[\s\S]*$/i, "")
    .trim();
}

// Turns SDK and network errors into one plain sentence for the admin.
export function describeAiError(err: unknown): string {
  if (err instanceof OpenAI.APIConnectionTimeoutError) return "The server didn't answer in time.";
  if (err instanceof OpenAI.APIConnectionError) {
    return "Couldn't reach the server. Check the address and that the server is running.";
  }
  if (err instanceof OpenAI.AuthenticationError) return "The server rejected the API key.";
  if (err instanceof OpenAI.NotFoundError) return "The server doesn't know this model or address. Check the model name.";
  if (err instanceof OpenAI.APIError) return `The server returned an error (${err.status ?? "unknown"}): ${err.message}`;
  return err instanceof Error ? err.message : "Something went wrong.";
}
