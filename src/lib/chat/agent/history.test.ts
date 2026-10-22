import assert from "node:assert/strict";
import { test } from "node:test";
import { lastAssistantText, missingToolResults, rebuildHistory, toolResultContents, toRow, type StoredRow } from "./history";
import { collectKnownNumbers, extractNumbers } from "./numbers";

// An assistant message as a provider returns it, with extra fields a request doesn't take.
const received = {
  role: "assistant",
  content: null,
  refusal: null,
  annotations: [],
  reasoning_content: "thinking...",
  tool_calls: [{ id: "call_1", type: "function", function: { name: "search_listings", arguments: '{"bedrooms":2}' } }],
};

const rows: StoredRow[] = [
  { seq: 3, ...toRow({ role: "tool", tool_call_id: "call_1", content: '{"units":[{"price":1450000}]}' }) },
  { seq: 1, ...toRow({ role: "user", content: "2 bed?" }) },
  { seq: 2, ...toRow(received) },
  { seq: 4, ...toRow({ role: "assistant", content: "<think>hmm</think>One 2-bed at AED 1,450,000." }) },
  { seq: 5, role: "user", raw: "not json" },
];

test("rebuilds request messages in seq order, passing content back unchanged", () => {
  const messages = rebuildHistory(rows);
  assert.deepEqual(messages, [
    { role: "user", content: "2 bed?" },
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "call_1", type: "function", function: { name: "search_listings", arguments: '{"bedrooms":2}' } }],
    },
    { role: "tool", tool_call_id: "call_1", content: '{"units":[{"price":1450000}]}' },
    { role: "assistant", content: "<think>hmm</think>One 2-bed at AED 1,450,000." },
  ]);
});

test("stored rows keep everything the provider returned", () => {
  const row = toRow(received);
  assert.equal(row.role, "assistant");
  assert.deepEqual(JSON.parse(row.raw), received);
});

test("finds tool calls left without results", () => {
  const messages = rebuildHistory(rows.filter((r) => r.seq !== 3));
  assert.deepEqual(
    missingToolResults(messages).map((m) => (m.role === "tool" ? m.tool_call_id : null)),
    ["call_1"],
  );
  assert.deepEqual(missingToolResults(rebuildHistory(rows)), []);
});

test("reads the last assistant text and tool results", () => {
  const messages = rebuildHistory(rows);
  assert.equal(lastAssistantText(messages), "<think>hmm</think>One 2-bed at AED 1,450,000.");
  assert.deepEqual(toolResultContents(messages), ['{"units":[{"price":1450000}]}']);
});

test("extracts numbers in the formats replies use", () => {
  const has = (text: string, n: number) => assert.ok(extractNumbers(text).includes(n), `${text} -> ${n}`);
  has("AED 1,450,000", 1_450_000);
  has("from 1.2M", 1_200_000);
  has("from 1.2M", 1.2);
  has("850k deposit", 850_000);
  has("2 million", 2_000_000);
  has("٣ غرف", 3);
  has("size 1,050.5 sqft", 1050.5);
  assert.deepEqual(collectKnownNumbers(["60/40"], [null, 5]).sort((a, b) => a - b), [5, 40, 60]);
});
