import type OpenAI from "openai";
import { createAiClient, describeAiError, visibleText } from "@/lib/ai/client";
import { getAiConnection, parseJson } from "@/lib/connections";
import { prisma } from "@/lib/db";
import { getActiveRules } from "@/lib/knowledge/queries";
import { checkEndpoint } from "@/lib/net";
import {
  lastAssistantText,
  missingToolResults,
  rebuildHistory,
  toolResultContents,
  toRequestMessage,
  toRow,
  userContents,
  type ProviderMessage,
} from "./agent/history";
import { collectKnownNumbers } from "./agent/numbers";
import {
  buildDataSection,
  buildSystemPrompt,
  composeUserContent,
  currentDataSection,
  dataUpdateNote,
  LEAD_CONTEXT_HEADING,
  leadContextNote,
  outsideMessagesNote,
  parseScopeLabel,
  regenerateNote,
  scopePrompt,
  scopeUserContent,
  type BusinessData,
} from "./agent/prompt";
import { newTurnState, runTool, type TurnState } from "./agent/run-tools";
import { TOOLS } from "./agent/tools";
import { checkReply, offTopicReply } from "./guard";
import { readSettings } from "./settings";
import type { AgentTurnResult, InboundInput, Lang, Qualification, ReplyCheckResult, ScopeLabel } from "./types";

const MAX_TOOL_ROUNDS = 6;
const MAX_OUTPUT_TOKENS = 1500;
const AI_TIMEOUT_MS = 90_000;
// Messages from outside the AI (scripted flow, a person) carried over as context.
const OUTSIDE_MESSAGES = 20;

type Outcome = "replied" | "off_topic" | "fallback" | "handoff" | "error";
type Usage = { input: number; output: number };

/**
 * Runs one AI turn for a conversation: optional topic check, then the model with tools
 * (search_knowledge, search_listings, save_qualification, list_slots, book_viewing, send_document,
 * handoff_to_human), then the reply check. Reads and appends AiMessage rows for the conversation;
 * never edits earlier ones. Never throws: problems come back in `error` with empty messages.
 */
export async function runAgentTurn(args: { orgId: string; conversationId: string; input: InboundInput; lang: Lang }): Promise<AgentTurnResult> {
  const tokens: Usage = { input: 0, output: 0 };
  const state = newTurnState();
  // The pipeline writes the AgentRun row from the result; `guard` notes go to the server log only.
  const run: TurnRefs["run"] = { model: "", outcome: "error", scope: null, guard: {}, error: null };
  let messages: AgentTurnResult["messages"] = [];
  let replyCheck: ReplyCheckResult | null = null;

  try {
    const turn = await runTurn(args, { tokens, state, run });
    messages = turn.messages;
    replyCheck = turn.replyCheck;
  } catch (err) {
    console.error("AI agent turn failed", err);
    run.error = describeAiError(err);
    run.outcome = "error";
  }
  if (run.guard.scopeError || run.guard.transcriptError) {
    console.warn(`AI agent turn for conversation ${args.conversationId}:`, run.guard);
  }

  return {
    messages: run.error ? [] : messages,
    patch: state.patch,
    booking: state.booking,
    handoff: state.handoff,
    scope: run.scope,
    toolCalls: state.toolCalls,
    passages: state.passages,
    replyCheck,
    tokens,
    error: run.error,
  };
}

type TurnRefs = {
  tokens: Usage;
  state: TurnState;
  run: { model: string; outcome: Outcome; scope: ScopeLabel | null; guard: Record<string, unknown>; error: string | null };
};

async function runTurn(
  args: { orgId: string; conversationId: string; input: InboundInput; lang: Lang },
  { tokens, state, run }: TurnRefs,
): Promise<{ messages: AgentTurnResult["messages"]; replyCheck: ReplyCheckResult | null }> {
  const now = new Date();
  const fail = (error: string) => {
    run.error = error;
    run.outcome = "error";
    return { messages: [], replyCheck: null };
  };

  const conversation = await prisma.conversation.findFirst({
    where: { id: args.conversationId, orgId: args.orgId },
    select: {
      id: true,
      systemPrompt: true,
      org: { select: { name: true, settings: true } },
      lead: {
        select: {
          id: true,
          name: true,
          qualification: true,
          projectId: true,
          project: {
            select: {
              name: true,
              community: true,
              city: true,
              developer: true,
              status: true,
              handover: true,
              paymentPlan: true,
              permitNumber: true,
              description: true,
            },
          },
        },
      },
    },
  });
  if (!conversation) return fail("Conversation not found.");
  const { lead, org } = conversation;
  const settings = readSettings(org.settings);
  const qualification = parseJson<Qualification>(lead.qualification, {});

  const ai = await getAiConnection(args.orgId);
  if (!ai) return fail("No AI connection.");
  run.model = ai.config.chatModel;
  const endpoint = await checkEndpoint(ai.config.baseUrl);
  if (!endpoint.ok) return fail(endpoint.reason);
  const client = createAiClient({ baseUrl: ai.config.baseUrl, apiKey: ai.apiKey, timeoutMs: AI_TIMEOUT_MS });

  // The transcript so far, and what happened outside it since the AI's last turn.
  const rows = await prisma.aiMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { seq: "asc" },
    select: { seq: true, role: true, raw: true, createdAt: true },
  });
  const history = rebuildHistory(rows);
  const lastAiAt = rows.at(-1)?.createdAt ?? new Date(0);
  const outside = (
    await prisma.message.findMany({
      where: { conversationId: conversation.id, createdAt: { gt: lastAiAt } },
      orderBy: { createdAt: "desc" },
      take: OUTSIDE_MESSAGES + 1,
      select: { direction: true, author: true, kind: true, body: true },
    })
  ).reverse();
  // The lead's current message may already be saved; it is sent as the lead's text, not as context.
  const current = outside.at(-1)?.direction === "in" ? outside.pop() : undefined;
  const leadText = (args.input.text?.trim() || current?.body.trim() || (args.input.replyId ? `(tapped option ${args.input.replyId})` : "")).trim();
  if (!leadText) return fail("The lead's message is empty.");

  // 1. Topic check: off-topic and abusive messages never reach the main model.
  if (settings.scopeCheck) {
    const scopeModel = ai.config.scopeModel.trim() || ai.config.chatModel;
    run.guard.scopeModel = scopeModel;
    try {
      const completion = await client.chat.completions.create({
        model: scopeModel,
        messages: [
          { role: "system", content: scopePrompt(org.name, lead.project?.name ?? null) },
          { role: "user", content: scopeUserContent(leadText, visibleText(lastAssistantText(history))) },
        ],
        max_tokens: MAX_OUTPUT_TOKENS,
      });
      addUsage(tokens, completion.usage);
      const answer = visibleText(completion.choices[0]?.message?.content);
      run.scope = parseScopeLabel(answer);
      if (!run.scope) run.guard.scopeAnswer = answer.slice(0, 100);
    } catch (err) {
      // A failed topic check shouldn't silence the lead; the main agent is still narrow.
      run.guard.scopeError = describeAiError(err);
    }
    if (run.scope === "off_topic" || run.scope === "abuse") {
      run.outcome = "off_topic";
      return { messages: [{ kind: "text", body: offTopicReply(lead.project?.name ?? null)[args.lang] }], replyCheck: null };
    }
  }

  // 2. The frozen system prompt, plus notes for anything that changed since.
  const data = await loadBusinessData(args.orgId, lead.projectId, lead.project, now);
  const freshSection = buildDataSection(data);
  let systemPrompt = conversation.systemPrompt;
  const notes: string[] = [];
  if (!systemPrompt) {
    systemPrompt = buildSystemPrompt(org.name, data);
    const frozen = await prisma.conversation.updateMany({
      where: { id: conversation.id, systemPrompt: null },
      data: { systemPrompt, aiConnectionId: ai.row.id },
    });
    if (frozen.count === 0) {
      // Another turn froze it first; use that one.
      const latest = await prisma.conversation.findUnique({ where: { id: conversation.id }, select: { systemPrompt: true } });
      systemPrompt = latest?.systemPrompt ?? systemPrompt;
    }
  }
  const pastUser = userContents(history);
  if (currentDataSection(systemPrompt, pastUser) !== freshSection) notes.push(dataUpdateNote(freshSection));
  const outsideNote = outsideMessagesNote(outside);
  if (outsideNote) notes.push(outsideNote);
  const leadNote = leadContextNote({ name: lead.name, lang: args.lang, qualification });
  const lastLeadNote = [...pastUser].reverse().find((c) => c.includes(LEAD_CONTEXT_HEADING));
  if (!lastLeadNote?.includes(leadNote)) notes.push(leadNote);

  // 3. The model with tools.
  const messages: ProviderMessage[] = [{ role: "system", content: systemPrompt }, ...history];
  const appended: Array<{ role: string; raw: string }> = [];
  const push = (sent: ProviderMessage, stored: object & { role: string } = sent) => {
    messages.push(sent);
    appended.push(toRow(stored));
  };
  for (const missing of missingToolResults(history)) push(missing);
  push({ role: "user", content: composeUserContent(leadText, notes) });

  const knownNumbers = () =>
    collectKnownNumbers(
      [...toolResultContents(history), ...state.factTexts, freshSection, leadText],
      [qualification.budgetMin, qualification.budgetMax, state.patch.budgetMin, state.patch.budgetMax],
    );

  let toolRounds = 0;
  let toolLimitHit = false;
  let regenerated = false;
  let replyCheck: ReplyCheckResult | null = null;
  const replyChecks: ReplyCheckResult[] = [];
  let reply: string | null = null;
  let loopError: string | null = null;

  try {
    for (let call = 0; call < MAX_TOOL_ROUNDS + 4; call++) {
      const completion = await client.chat.completions.create({
        model: ai.config.chatModel,
        messages,
        tools: TOOLS,
        max_tokens: MAX_OUTPUT_TOKENS,
      });
      addUsage(tokens, completion.usage);
      const choice = completion.choices[0];
      const received = choice?.message;
      const sent = received && toRequestMessage(received);
      if (!received || !sent) throw new Error("The model returned no message.");
      push(sent, received);

      if (received.refusal) {
        loopError = "The model declined to answer.";
        break;
      }

      const calls = received.tool_calls ?? [];
      if (calls.length > 0) {
        const allowed = !toolLimitHit && toolRounds < MAX_TOOL_ROUNDS;
        if (allowed) toolRounds++;
        else if (toolLimitHit) state.handoff = true;
        for (const tc of calls) {
          const content = !allowed
            ? JSON.stringify({ error: "No more tool calls this turn. Reply to the lead now, or say a colleague will follow up." })
            : tc.type === "function"
              ? await runTool({ orgId: args.orgId, leadId: lead.id, projectId: lead.projectId, now }, state, tc.function.name, tc.function.arguments)
              : JSON.stringify({ error: "Only function tools are available." });
          push({ role: "tool", tool_call_id: tc.id, content });
        }
        if (!allowed && toolLimitHit) {
          state.handoffReason ??= "The AI kept calling tools without replying.";
          break;
        }
        if (!allowed) toolLimitHit = true;
        continue;
      }

      const text = visibleText(received.content);
      replyCheck = text
        ? checkReply(text, { settings, knownNumbers: knownNumbers() })
        : { ok: false, reason: choice.finish_reason === "length" ? "it ran out of room before writing a reply" : "the reply was empty" };
      replyChecks.push(replyCheck);
      if (replyCheck.ok) {
        reply = text;
        break;
      }
      if (regenerated) {
        // Second failure: a person takes over rather than sending a bad reply.
        state.handoff = true;
        state.handoffReason ??= `The AI's reply failed the check twice (${replyCheck.reason}).`;
        break;
      }
      regenerated = true;
      push({ role: "user", content: regenerateNote(replyCheck.reason, settings.maxReplyChars) });
    }
    if (reply === null && !loopError && !state.handoff) {
      state.handoff = true;
      state.handoffReason ??= "The AI didn't produce a reply.";
    }
  } catch (err) {
    loopError = describeAiError(err);
  }

  // 4. Append this turn's messages to the transcript, whatever happened.
  await appendTranscript(conversation.id, rows.at(-1)?.seq ?? 0, appended, run.guard);

  run.guard.toolRounds = toolRounds;
  run.guard.regenerated = regenerated;
  run.guard.replyChecks = replyChecks;
  if (state.handoffReason) run.guard.handoffReason = state.handoffReason;

  if (loopError) return fail(loopError);
  const out: AgentTurnResult["messages"] = [];
  if (reply) out.push({ kind: "text", body: reply });
  out.push(...state.documents);
  run.outcome = state.handoff ? "handoff" : reply ? "replied" : "fallback";
  return { messages: out, replyCheck };
}

async function loadBusinessData(
  orgId: string,
  projectId: string | null,
  project: BusinessData["project"],
  now: Date,
): Promise<BusinessData> {
  const [rules, documents] = await Promise.all([
    getActiveRules(orgId, projectId, now),
    prisma.knowledgeSource.findMany({
      where: {
        orgId,
        kind: "file",
        status: "ready",
        AND: [
          { OR: [{ projectId: null }, ...(projectId ? [{ projectId }] : [])] },
          { OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
        ],
      },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      take: 20,
      select: { id: true, title: true },
    }),
  ]);
  return { rules, project, documents };
}

async function appendTranscript(conversationId: string, lastSeq: number, rows: Array<{ role: string; raw: string }>, guard: Record<string, unknown>) {
  if (rows.length === 0) return;
  try {
    await prisma.aiMessage.createMany({
      data: rows.map((row, i) => ({ conversationId, seq: lastSeq + i + 1, role: row.role, raw: row.raw })),
    });
  } catch (err) {
    // Most likely another turn wrote the same seq numbers; the reply itself is still fine to send.
    console.error("Couldn't save the AI transcript", err);
    guard.transcriptError = err instanceof Error ? err.message : "unknown error";
  }
}

function addUsage(tokens: Usage, usage: OpenAI.Completions.CompletionUsage | undefined) {
  tokens.input += usage?.prompt_tokens ?? 0;
  tokens.output += usage?.completion_tokens ?? 0;
}
