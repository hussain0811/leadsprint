import OpenAI from "openai";
import { describeAiError, visibleText } from "./client";

// The five checks run on "Test connection". Reply, tools and JSON are needed for the AI agent;
// Arabic and embeddings are recommended.

export type CheckId = "reply" | "tools" | "json" | "arabic" | "embeddings" | "scope";
export type CheckStatus = "pass" | "fail" | "skipped";
export type CheckResult = {
  id: CheckId;
  label: string;
  required: boolean;
  status: CheckStatus;
  detail: string;
  ms: number;
  thinkingTokens?: number;
};
// ok: ready for the AI agent (optional checks may still fail); warning: a required check failed; error: no reply at all.
export type AiStatus = "ok" | "warning" | "error";
export type AiCheckRun = { status: AiStatus; results: CheckResult[]; notes: string[]; checkedAt: string };

type Usage = OpenAI.Chat.Completions.ChatCompletion["usage"];

// Reasoning models spend tokens thinking before they answer, so leave plenty of room.
const MAX_TOKENS = 1500;

const LABELS: Record<CheckId, { label: string; required: boolean }> = {
  reply: { label: "Replies to a message", required: true },
  tools: { label: "Uses tools", required: true },
  json: { label: "Returns valid JSON", required: true },
  arabic: { label: "Replies in Arabic", required: false },
  embeddings: { label: "Creates embeddings", required: false },
  scope: { label: "Topic check model replies", required: false },
};

function result(id: CheckId, status: CheckStatus, detail: string, ms = 0, usage?: Usage): CheckResult {
  return { id, ...LABELS[id], status, detail, ms, thinkingTokens: usage?.completion_tokens_details?.reasoning_tokens ?? 0 };
}

async function timed<T>(fn: () => Promise<T>) {
  const start = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - start };
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function thinkingNote(usage: Usage) {
  const tokens = usage?.completion_tokens_details?.reasoning_tokens ?? 0;
  return tokens > 0 ? `, after ${tokens} thinking tokens` : "";
}

function emptyReplyDetail(finishReason: string | undefined, usage: Usage, ms: number) {
  if (finishReason !== "length") return "Replied with an empty message.";
  const thinking = usage?.completion_tokens_details?.reasoning_tokens;
  return thinking
    ? `Thought for ${thinking} tokens (${seconds(ms)}) and ran out of room before answering.`
    : `Ran out of room after ${usage?.completion_tokens ?? MAX_TOKENS} tokens (${seconds(ms)}) without answering.`;
}

async function checkReply(client: OpenAI, model: string, id: "reply" | "scope" = "reply") {
  try {
    const { value, ms } = await timed(() =>
      client.chat.completions.create({
        model,
        messages: [{ role: "user", content: "Reply with the single word: ready" }],
        max_tokens: MAX_TOKENS,
      }),
    );
    const choice = value.choices[0];
    const text = visibleText(choice?.message?.content);
    if (!text) return result(id, "fail", emptyReplyDetail(choice?.finish_reason, value.usage, ms), ms, value.usage);
    return result(id, "pass", `Replied "${truncate(text, 40)}" in ${seconds(ms)}${thinkingNote(value.usage)}.`, ms, value.usage);
  } catch (err) {
    return result(id, "fail", describeAiError(err));
  }
}

const priceTool = {
  type: "function",
  function: {
    name: "get_unit_price",
    description: "Look up the asking price of a property unit",
    parameters: {
      type: "object",
      properties: { unit_no: { type: "string", description: "Unit number, for example B-1502" } },
      required: ["unit_no"],
    },
  },
} satisfies OpenAI.Chat.Completions.ChatCompletionTool;

async function checkTools(client: OpenAI, model: string) {
  try {
    const { value, ms } = await timed(() =>
      client.chat.completions.create({
        model,
        messages: [{ role: "user", content: "What is the price of unit B-1502? Use the tool." }],
        tools: [priceTool],
        max_tokens: MAX_TOKENS,
      }),
    );
    const choice = value.choices[0];
    const call = choice?.message?.tool_calls?.[0];
    if (!call && choice?.finish_reason === "length") {
      return result("tools", "fail", emptyReplyDetail(choice.finish_reason, value.usage, ms), ms, value.usage);
    }
    if (!call || call.type !== "function") {
      return result("tools", "fail", "Answered without using the tool. The AI agent needs a model that supports tool calling.", ms, value.usage);
    }
    let unitNo = "";
    try {
      unitNo = String(JSON.parse(call.function.arguments || "{}").unit_no ?? "");
    } catch {
      // handled below as unexpected input
    }
    if (call.function.name !== priceTool.function.name || !unitNo.includes("1502")) {
      return result("tools", "fail", "Used the tool, but with unexpected input.", ms, value.usage);
    }
    return result("tools", "pass", `Called the tool correctly in ${seconds(ms)}${thinkingNote(value.usage)}.`, ms, value.usage);
  } catch (err) {
    return result("tools", "fail", describeAiError(err));
  }
}

const leadSchema = {
  type: "object",
  properties: { name: { type: "string" }, budget: { type: "number" }, bedrooms: { type: "integer" } },
  required: ["name", "budget", "bedrooms"],
  additionalProperties: false,
};

async function checkJson(client: OpenAI, model: string) {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: "Return only a JSON object with the keys name, budget and bedrooms. No other text." },
    { role: "user", content: "Lead details: Sara, budget 1,500,000 AED, wants 2 bedrooms." },
  ];
  try {
    let structured = true;
    const { value, ms } = await timed(async () => {
      try {
        return await client.chat.completions.create({
          model,
          messages,
          max_tokens: MAX_TOKENS,
          response_format: { type: "json_schema", json_schema: { name: "lead", schema: leadSchema, strict: true } },
        });
      } catch (err) {
        // Servers without structured output reject the response_format; ask for plain JSON instead.
        if (!(err instanceof OpenAI.BadRequestError)) throw err;
        structured = false;
        return client.chat.completions.create({ model, messages, max_tokens: MAX_TOKENS });
      }
    });
    const choice = value.choices[0];
    const text = visibleText(choice?.message?.content).replace(/^```(?:json)?\s*|\s*```$/g, "");
    if (!text) return result("json", "fail", emptyReplyDetail(choice?.finish_reason, value.usage, ms), ms, value.usage);
    let parsed: { name?: unknown; budget?: unknown; bedrooms?: unknown };
    try {
      parsed = JSON.parse(text);
    } catch {
      return result("json", "fail", `Returned text that isn't valid JSON: "${truncate(text, 60)}"`, ms, value.usage);
    }
    const correct =
      String(parsed.name ?? "").toLowerCase().includes("sara") &&
      Number(parsed.budget) === 1_500_000 &&
      Number(parsed.bedrooms) === 2;
    if (!correct) return result("json", "fail", "Returned JSON, but with the wrong values.", ms, value.usage);
    return result(
      "json",
      "pass",
      structured
        ? `Returned valid JSON using structured output in ${seconds(ms)}${thinkingNote(value.usage)}.`
        : `Returned valid JSON in ${seconds(ms)}. This server doesn't support structured output, so answers are checked after they arrive.`,
      ms,
      value.usage,
    );
  } catch (err) {
    return result("json", "fail", describeAiError(err));
  }
}

async function checkArabic(client: OpenAI, model: string) {
  try {
    const { value, ms } = await timed(() =>
      client.chat.completions.create({
        model,
        messages: [
          {
            role: "user",
            content: "Reply in Arabic only, in one short sentence: welcome a property buyer and ask about their budget.",
          },
        ],
        max_tokens: MAX_TOKENS,
      }),
    );
    const choice = value.choices[0];
    const text = visibleText(choice?.message?.content);
    if (!text) return result("arabic", "fail", emptyReplyDetail(choice?.finish_reason, value.usage, ms), ms, value.usage);
    const letters = text.match(/\p{L}/gu)?.length ?? 0;
    const arabic = text.match(/\p{Script=Arabic}/gu)?.length ?? 0;
    if (letters === 0 || arabic / letters < 0.6) {
      return result("arabic", "fail", "Replied mostly in another language, so Arabic-speaking leads may get English replies.", ms, value.usage);
    }
    return result("arabic", "pass", `Replied in Arabic in ${seconds(ms)}: ${truncate(text, 80)}`, ms, value.usage);
  } catch (err) {
    return result("arabic", "fail", describeAiError(err));
  }
}

async function checkEmbeddings(client: OpenAI, model: string) {
  if (!model) return result("embeddings", "skipped", "No embedding model chosen, so document search will match keywords only.");
  try {
    const { value, ms } = await timed(() =>
      client.embeddings.create({
        model,
        input: ["Two-bedroom apartment with a sea view in Dubai Marina"],
        encoding_format: "float",
      }),
    );
    const size = value.data[0]?.embedding?.length ?? 0;
    if (!size) return result("embeddings", "fail", "The server returned an empty embedding.", ms);
    return result("embeddings", "pass", `Created an embedding with ${size} dimensions in ${seconds(ms)}.`, ms);
  } catch (err) {
    return result("embeddings", "fail", describeAiError(err));
  }
}

export async function runAiChecks(
  client: OpenAI,
  models: { chatModel: string; embeddingModel: string; scopeModel: string },
): Promise<AiCheckRun> {
  const separateScopeModel = models.scopeModel && models.scopeModel !== models.chatModel;
  const results: CheckResult[] = [await checkReply(client, models.chatModel)];

  if (results[0].status === "fail") {
    // If the server can't reply at all, every other check would fail the same way.
    const rest: CheckId[] = ["tools", "json", "arabic", "embeddings", ...(separateScopeModel ? (["scope"] as const) : [])];
    for (const id of rest) results.push(result(id, "skipped", "Skipped because the model couldn't reply."));
  } else {
    // One at a time: local servers usually run a single request at once.
    results.push(await checkTools(client, models.chatModel));
    results.push(await checkJson(client, models.chatModel));
    results.push(await checkArabic(client, models.chatModel));
    results.push(await checkEmbeddings(client, models.embeddingModel));
    if (separateScopeModel) results.push(await checkReply(client, models.scopeModel, "scope"));
  }

  const status: AiStatus =
    results[0].status === "fail" ? "error" : results.some((r) => r.required && r.status === "fail") ? "warning" : "ok";
  return { status, results, notes: thinkingNotes(results), checkedAt: new Date().toISOString() };
}

// Reasoning models think before every reply. Live chat needs quick answers, so say so plainly.
function thinkingNotes(results: CheckResult[]) {
  const reply = results.find((r) => r.id === "reply");
  const ranOut = results.some((r) => r.status === "fail" && r.detail.includes("ran out of room"));
  if (!reply?.thinkingTokens && !ranOut) return [];
  const replyNote = reply?.thinkingTokens
    ? `This model thinks before it answers: ${reply.thinkingTokens} thinking tokens for a one-word reply.`
    : "This model thinks before it answers.";
  return [
    `${replyNote} Leads would wait a long time for each reply. Turn thinking off for this model in your server's settings if it has that option, or load a model without thinking (an "instruct" model).`,
  ];
}
