import assert from "node:assert/strict";
import { test } from "node:test";
import { chunkPages } from "./chunk";

const sentence = (n: number) => `Sentence number ${n} talks about the project in some detail.`;

test("never crosses a page boundary and numbers passages across the document", () => {
  const drafts = chunkPages([
    { page: 1, text: "Tower A has 40 floors." },
    { page: 2, text: "" },
    { page: 3, text: "Tower B has 32 floors." },
  ]);
  assert.deepEqual(
    drafts.map((d) => [d.ordinal, d.page, d.text]),
    [
      [0, 1, "Tower A has 40 floors."],
      [1, 3, "Tower B has 32 floors."],
    ],
  );
});

test("headings come from # lines and from short title lines", () => {
  const text = [
    "# Payment plan",
    "20% on booking, 80% on handover.",
    "Amenities",
    "A pool, a gym and a kids' play area.",
    "## Location ##\nNext to the metro.",
  ].join("\n\n");
  assert.deepEqual(
    chunkPages([{ page: null, text }]).map((d) => [d.heading, d.text]),
    [
      ["Payment plan", "20% on booking, 80% on handover."],
      ["Amenities", "A pool, a gym and a kids' play area."],
      ["Location", "Next to the metro."],
    ],
  );
});

test("short lines that aren't titles stay content", () => {
  // A price, a "Label: value" line, and a list laid out one item per paragraph.
  const text = "AED 1,200,000\n\nHandover: Q4 2026\n\nPool\n\nGym\n\nSauna";
  assert.deepEqual(
    chunkPages([{ page: null, text }]).map((d) => [d.heading, d.text]),
    [[null, text]],
  );
});

test("the heading carries over to the next page", () => {
  const drafts = chunkPages([
    { page: 1, text: "# Payment plan\n\n10% on booking." },
    { page: 2, text: "90% on handover." },
  ]);
  assert.deepEqual(
    drafts.map((d) => [d.page, d.heading]),
    [
      [1, "Payment plan"],
      [2, "Payment plan"],
    ],
  );
});

test("packs paragraphs to about the target size with a sentence-aligned overlap", () => {
  const paragraphs = Array.from({ length: 12 }, (_, p) => [0, 1, 2].map((s) => sentence(p * 3 + s)).join(" "));
  const drafts = chunkPages([{ page: 1, text: paragraphs.join("\n\n") }], { targetChars: 400, overlapChars: 80 });

  assert.ok(drafts.length > 3);
  for (const draft of drafts) assert.ok(draft.text.length <= 400 + 80, `${draft.text.length} characters`);
  // Each passage after the first starts with the last sentence of the one before.
  for (let i = 1; i < drafts.length; i++) {
    const first = drafts[i].text.split(/(?<=\.)\s+/)[0];
    assert.ok(drafts[i - 1].text.endsWith(first), `passage ${i} doesn't overlap the one before`);
  }
  const all = drafts.map((d) => d.text).join(" ");
  for (let n = 0; n < 36; n++) assert.ok(all.includes(sentence(n)), `sentence ${n} is missing`);
});

test("a long paragraph without sentence ends is split between words", () => {
  const words = Array.from({ length: 300 }, (_, i) => `word${i}`).join(" ");
  const drafts = chunkPages([{ page: 1, text: words }], { targetChars: 500, overlapChars: 0 });
  assert.ok(drafts.length >= 4);
  for (const draft of drafts) assert.ok(draft.text.length <= 500);
  assert.equal(drafts.map((d) => d.text).join(" "), words);
});

test("Arabic question marks end sentences", () => {
  const text = Array.from({ length: 20 }, (_, i) => `هل يوجد موقف سيارات رقم ${i}؟ نعم يوجد موقف خاص لكل شقة.`).join(" ");
  const drafts = chunkPages([{ page: null, text }], { targetChars: 300, overlapChars: 60 });
  assert.ok(drafts.length > 1);
  for (const draft of drafts) {
    assert.match(draft.text, /^(هل|نعم) /);
    assert.match(draft.text, /[؟.]$/);
  }
});

test("spreadsheet rows stay whole", () => {
  const rows = Array.from({ length: 60 }, (_, i) => `Unit: A-${100 + i}; Bedrooms: 2; Price: ${1_000_000 + i * 10_000}`);
  const drafts = chunkPages([{ page: null, text: `# Units\n\n${rows.join("\n")}` }]);
  assert.ok(drafts.length > 1);
  for (const draft of drafts) {
    assert.equal(draft.heading, "Units");
    for (const line of draft.text.split("\n")) assert.ok(rows.includes(line), line);
  }
});

test("returns nothing for pages without text", () => {
  assert.deepEqual(chunkPages([{ page: 1, text: "  \n\n " }, { page: 2, text: "" }]), []);
  assert.deepEqual(chunkPages([]), []);
});
