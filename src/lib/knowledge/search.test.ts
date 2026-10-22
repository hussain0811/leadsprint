import assert from "node:assert/strict";
import { test } from "node:test";
import { tokenize } from "./normalize";
import { bm25Scores, rankCandidates, reciprocalRankFusion, similarityFloor, type RankInput } from "./search";

const doc = (searchText: string, vector: number[] | null = null): RankInput => ({
  origin: "document",
  searchText,
  vector: vector && new Float32Array(vector),
});
const qa = (searchText: string, vector: number[] | null = null): RankInput => ({ ...doc(searchText, vector), origin: "qa" });

test("BM25 rewards matching more words, rarer words and repeats, with diminishing returns", () => {
  const docs = [
    "Payment plan: 60/40 with post-handover payments.",
    "The pool and gym are on the podium level.",
    "Handover is planned for the fourth quarter.",
    "Payment by bank transfer.",
  ].map(tokenize);
  const scores = bm25Scores(tokenize("payment plan"), docs);
  assert.ok(scores[0] > scores[3] && scores[3] > 0);
  assert.equal(scores[1], 0);
  assert.equal(scores[2], 0);

  const [rare, common] = bm25Scores(["pool", "payment"], [["pool", "a"], ["payment", "b"], ["payment", "c"]]);
  assert.ok(rare > common);

  const [three, one] = bm25Scores(["villa"], [["villa", "villa", "villa"], ["villa", "x", "y"], ["a", "b", "c"]]);
  assert.ok(three > one && three < 3 * one);
});

test("ranks English passages by their keywords and drops the rest", () => {
  const candidates = [
    doc("Amenities\nResidents enjoy a pool, a gym and a kids' play area."),
    doc("Payment plan\n10% on booking, 50% during construction and 40% on handover."),
    doc("Location\nThe tower is a five-minute walk from the metro station."),
  ];
  const ranked = rankCandidates("What is the payment plan?", candidates);
  assert.deepEqual(
    ranked.map((r) => [r.index, r.matchedBy]),
    [[1, ["keywords"]]],
  );
});

test("ranks Arabic passages whatever the spelling of the question", () => {
  const candidates = [
    doc("المرافق\nمسبح ونادي رياضي وحديقة للأطفال."),
    doc("خطة الدفع\nتدفع ١٠٪ عند الحجز و٩٠٪ عند التسليم."),
    doc("الموقع\nيقع البرج بجوار محطة المترو."),
  ];
  assert.equal(rankCandidates("ما هي خطّة الدّفع؟", candidates)[0]?.index, 1);

  const bedrooms = [doc("Studio apartments with a city view"), doc("شقق 3 غرف نوم بإطلالة على البحر")];
  assert.deepEqual(
    rankCandidates("شقة ٣ غرف", bedrooms).map((r) => r.index),
    [1],
  );
});

test("a Q&A pair wins a close call against a document", () => {
  const text = "Is there parking?\nEach apartment comes with one parking space.";
  const ranked = rankCandidates("parking space", [doc(text), qa(text)]);
  assert.deepEqual(
    ranked.map((r) => r.index),
    [1, 0],
  );
});

test("the Q&A boost is modest: a weak answer doesn't jump over strong passages", () => {
  const candidates = [
    ...Array.from({ length: 5 }, (_, i) => doc(`Parking ${i}\nParking: two parking spaces per unit, plus visitor parking.`)),
    qa("Do you allow pets?\nPets are welcome. Visitor parking is limited."),
  ];
  const ranked = rankCandidates("parking", candidates, { limit: 10 });
  assert.equal(ranked.length, 6);
  assert.equal(candidates[ranked[0].index].origin, "document");
  assert.ok(ranked.findIndex((r) => r.index === 5) >= 2);
});

test("reciprocal rank fusion rewards agreement between rankings", () => {
  const fused = reciprocalRankFusion([
    [0, 1, 2],
    [2, 1],
  ]);
  assert.equal(fused.get(0), 1 / 61);
  assert.equal(fused.get(1), 1 / 62 + 1 / 62);
  assert.equal(fused.get(2), 1 / 63 + 1 / 61);
  assert.ok((fused.get(1) ?? 0) > (fused.get(0) ?? 0));
  assert.equal(reciprocalRankFusion([[], []]).size, 0);
});

test("meaning finds passages that share no words with the question, and weak matches are dropped", () => {
  const candidates = [
    doc("Handover\nKeys are given to buyers in December 2026.", [0.9, 0.1, 0]),
    doc("Amenities\nPool and gym.", [0, 1, 0]),
    doc("Payment plan\n10% on booking."), // not embedded yet: keywords only
  ];
  const ranked = rankCandidates("When can I move in?", candidates, { queryVector: new Float32Array([1, 0, 0]) });
  assert.deepEqual(
    ranked.map((r) => [r.index, r.matchedBy]),
    [[0, ["meaning"]]],
  );
});

test("passages found by both keywords and meaning come first", () => {
  const candidates = [
    doc("Payment methods\nBank transfer or cheque.", [0, 1]),
    doc("Instalments\nPay in four instalments over two years.", [0.95, 0.3]),
    doc("Payment plan\n10% on booking.", [1, 0]),
  ];
  const ranked = rankCandidates("payment plan", candidates, { queryVector: new Float32Array([1, 0]) });
  // "Payment methods" shares one word and nothing else backs it, so it's dropped.
  assert.deepEqual(
    ranked.map((r) => [r.index, r.matchedBy]),
    [
      [2, ["keywords", "meaning"]],
      [1, ["meaning"]],
    ],
  );
});

test("one shared word isn't a keyword match unless meaning backs it up", () => {
  const candidates = [
    doc("Service charge\nThe service charge is AED 18 per square foot a year."),
    doc("Example Domain\nThis domain is for use in documentation examples without asking for permission. Customer service hours vary."),
    doc("Our services\nWe help with mortgages and residence visas."),
  ];
  assert.deepEqual(
    rankCandidates("service charge", candidates).map((r) => r.index),
    [0],
  );
  // The same weak match counts when the meaning ranking agrees.
  const withMeaning = rankCandidates("service charge", candidates, { queryVector: new Float32Array([1, 0]) });
  assert.deepEqual(withMeaning.map((r) => r.index), [0]);
  candidates[2] = { ...candidates[2], vector: new Float32Array([1, 0]) };
  assert.deepEqual(
    rankCandidates("service charge", candidates, { queryVector: new Float32Array([1, 0]) }).map((r) => [r.index, r.matchedBy]),
    [
      [2, ["keywords", "meaning"]],
      [0, ["keywords"]],
    ],
  );
  // Half the words with a score close to the best match is enough.
  const others = ["Pool and gym", "Metro station nearby", "Payment plan 60/40", "Handover in 2027"].map((text) => doc(text));
  const partial = rankCandidates("sea view villa", [doc("Villa with a sea view"), doc("Villa near the sea"), ...others]);
  assert.deepEqual(
    partial.map((r) => r.index),
    [0, 1],
  );
});

test("a source's priority settles near-ties but doesn't outweigh relevance", () => {
  const text = "Handover\nHandover is planned for Q4 2027.";
  const tie = rankCandidates("handover", [doc(text), { ...doc(text), priority: 3 }]);
  assert.deepEqual(
    tie.map((r) => r.index),
    [1, 0],
  );
  const weaker = rankCandidates("handover date", [doc("Handover date\nThe handover date is Q4 2027."), { ...doc("Handover is planned soon."), priority: 1000 }]);
  assert.equal(weaker[0].index, 0);
});

test("a meaning match must be fairly strong and close to the best one", () => {
  assert.ok(Math.abs(similarityFloor([0.9, 0.5, -Infinity]) - 0.8) < 1e-9);
  assert.equal(similarityFloor([0.25, 0.1]), 0.3);
  assert.equal(similarityFloor([]), 0.3);
});

test("returns at most `limit` passages, 6 by default", () => {
  const candidates = Array.from({ length: 10 }, (_, i) => doc(`Unit ${i} has a sea view.`));
  assert.equal(rankCandidates("sea view", candidates).length, 6);
  assert.equal(rankCandidates("sea view", candidates, { limit: 3 }).length, 3);
  assert.deepEqual(rankCandidates("the and of", candidates), []);
});
