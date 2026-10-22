import assert from "node:assert/strict";
import { test } from "node:test";
import { parseToolCall, TOOL_NAMES, TOOLS } from "./tools";

test("every tool is defined once, with no forced or strict settings", () => {
  assert.deepEqual(TOOLS.map((t) => t.function.name), [...TOOL_NAMES]);
  for (const t of TOOLS) assert.equal(t.function.strict, undefined);
});

test("save_qualification accepts partial answers and tidies common model output", () => {
  const call = parseToolCall("save_qualification", JSON.stringify({ intent: "Buy", budgetMax: "2,000,000", bedrooms: 2, area: null, notes: "" }));
  assert.deepEqual(call, { ok: true, name: "save_qualification", args: { intent: "buy", budgetMax: 2_000_000, bedrooms: 2 } });
});

test("save_qualification rejects bad values, unknown fields and empty saves", () => {
  const bad = (args: unknown) => {
    const call = parseToolCall("save_qualification", JSON.stringify(args));
    assert.equal(call.ok, false);
    return call.ok ? "" : call.error;
  };
  assert.match(bad({ intent: "steal" }), /intent/);
  assert.match(bad({ bedrooms: 2.5 }), /bedrooms/);
  assert.match(bad({ budgetMin: 3_000_000, budgetMax: 1_000_000 }), /budgetMin/);
  assert.match(bad({ favouriteColour: "blue" }), /favouriteColour|Unrecognized/i);
  assert.match(bad({}), /at least one field/);
});

test("search_listings filters are optional and validated", () => {
  assert.deepEqual(parseToolCall("search_listings", ""), { ok: true, name: "search_listings", args: {} });
  assert.deepEqual(parseToolCall("search_listings", '{"bedrooms":0,"max_price":"1500000","type":"Villa"}'), {
    ok: true,
    name: "search_listings",
    args: { bedrooms: 0, max_price: 1_500_000, type: "villa" },
  });
  assert.equal(parseToolCall("search_listings", '{"bedrooms":-1}').ok, false);
});

test("required arguments, bad JSON and unknown tools come back as plain errors", () => {
  const book = parseToolCall("book_viewing", "{}");
  assert.equal(book.ok, false);
  assert.match(book.ok ? "" : book.error, /slot_id/);
  const json = parseToolCall("handoff_to_human", "{reason:");
  assert.deepEqual(json, { ok: false, error: "The arguments were not valid JSON." });
  const unknown = parseToolCall("run_shell", "{}");
  assert.match(unknown.ok ? "" : unknown.error, /no tool called "run_shell"/);
  assert.deepEqual(parseToolCall("search_knowledge", '{"query":"  payment plan "}'), {
    ok: true,
    name: "search_knowledge",
    args: { query: "payment plan" },
  });
  assert.equal(parseToolCall("list_slots", "{}").ok, true);
});
