import assert from "node:assert/strict";
import { test } from "node:test";
import { answeringMode, filtersQuery, parseFilters, previewText, sortByActivity } from "./filters";

test("filters are read from the query string, unknown values are off", () => {
  assert.deepEqual(parseFilters(new URLSearchParams("")), { needsHuman: false, takeover: false, projectId: null, q: "" });
  assert.deepEqual(parseFilters(new URLSearchParams("needs=1&takeover=true&project=p1&q=%20marina%20")), {
    needsHuman: true,
    takeover: true,
    projectId: "p1",
    q: "marina",
  });
  assert.equal(parseFilters(new URLSearchParams("needs=yes")).needsHuman, false);
  assert.equal(parseFilters(new URLSearchParams(`q=${"a".repeat(500)}`)).q.length, 100);
});

test("filters round-trip through the query string", () => {
  const filters = { needsHuman: true, takeover: false, projectId: "none", q: "مرسى" };
  assert.deepEqual(parseFilters(new URLSearchParams(filtersQuery(filters))), filters);
  assert.equal(filtersQuery({ needsHuman: false, takeover: false, projectId: null, q: "  " }), "");
});

test("who answers next", () => {
  const base = { humanTakeover: false, forceScripted: false, aiStopped: false, aiReady: true };
  assert.equal(answeringMode(base), "ai");
  assert.equal(answeringMode({ ...base, humanTakeover: true, forceScripted: true }), "person");
  assert.equal(answeringMode({ ...base, forceScripted: true }), "scripted");
  assert.equal(answeringMode({ ...base, aiStopped: true }), "scripted");
  assert.equal(answeringMode({ ...base, aiReady: false }), "scripted");
});

test("previews are one line and cut at a word", () => {
  assert.equal(previewText("Hello\n\n  there"), "Hello there");
  const long = "word ".repeat(40);
  const out = previewText(long, 22);
  assert.ok(out.endsWith("…"));
  assert.ok(out.length <= 23);
  assert.ok(!out.includes("wor…"));
});

test("newest activity comes first", () => {
  const items = [
    { id: "a", lastActivityAt: "2026-01-01T10:00:00Z" },
    { id: "c", lastActivityAt: "2026-01-02T10:00:00Z" },
    { id: "b", lastActivityAt: "2026-01-02T10:00:00Z" },
  ];
  assert.deepEqual(sortByActivity(items).map((i) => i.id), ["b", "c", "a"]);
});
