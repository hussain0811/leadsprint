import { createAiClient, describeAiError } from "../ai/client";
import { getAiConnection } from "../connections";
import { prisma } from "../db";
import { checkEndpoint } from "../net";
import { bytesToVector, cosineSimilarity, embedTexts } from "./embed";
import { tokenize } from "./normalize";
import type { Passage, SearchResult } from "./types";

const DEFAULT_LIMIT = 6;
const BM25_K1 = 1.2;
const BM25_B = 0.75;
const RRF_K = 60;
// Answers the admin wrote win close calls: worth about three places near the top of the list.
const QA_BOOST = 1.05;
// Each step of a source's priority (capped at ±5) is worth 0.2%. At most 1%, that settles ties
// but stays below the 1.6% between first and second place in one ranking.
const PRIORITY_STEP = 0.002;
const MAX_PRIORITY_STEPS = 5;
// A keyword-only match must hold every word of the question, or at least half of them and score
// at least half as well as the best match; one shared common word isn't enough.
const MIN_KEYWORD_COVERAGE = 0.5;
const MIN_KEYWORD_SHARE = 0.5;
// Below this a passage is unrelated to the question, whatever the model.
const MIN_SIMILARITY = 0.3;
// Models differ in their baseline similarity, so a meaning-only match must also be close to the
// best one. With nomic-embed-text, answers scored 0.69-0.75 and unrelated passages 0.43-0.60.
const SIMILARITY_SPREAD = 0.1;
// A chat reply can't wait long for the question's embedding; keywords answer without it.
const QUERY_EMBED_TIMEOUT_MS = 15_000;

export type RankInput = {
  origin: Passage["origin"];
  searchText: string;
  vector: Float32Array | null;
  priority?: number; // the source's priority; Q&A pairs have none
};
export type Ranked = { index: number; score: number; matchedBy: Passage["matchedBy"] };

type Candidate = RankInput & { passage: Omit<Passage, "score" | "matchedBy"> };
type AiConnection = NonNullable<Awaited<ReturnType<typeof getAiConnection>>>;

/**
 * Finds the passages that best answer `query` for one brokerage: reference-document chunks and
 * Q&A pairs that belong to `projectId` or to all projects (projectId null). Rules documents,
 * failed sources and sources past their validUntil date are excluded. Uses keyword ranking always,
 * and adds meaning ranking when passages have embeddings from the AI connection's current
 * embedding model and the query can be embedded; otherwise mode is "keywords".
 */
export async function searchKnowledge(args: {
  orgId: string;
  projectId?: string | null;
  query: string;
  limit?: number;
  now?: Date;
}): Promise<SearchResult> {
  const query = args.query.trim();
  const ai = await readAiConnection(args.orgId);
  const embeddingModel = ai?.config.embeddingModel.trim() || null;
  if (!query) return { passages: [], mode: "keywords", embeddingModel };

  const candidates = await loadCandidates(args.orgId, args.projectId ?? null, args.now ?? new Date(), embeddingModel);
  const queryVector =
    ai && embeddingModel && candidates.some((c) => c.vector) ? await embedQuery(ai, embeddingModel, query) : null;
  const ranked = rankCandidates(query, candidates, { queryVector, limit: args.limit });
  return {
    passages: ranked.map(({ index, score, matchedBy }) => ({ ...candidates[index].passage, score, matchedBy })),
    mode: queryVector ? "hybrid" : "keywords",
    embeddingModel,
  };
}

// A connection whose key can't be decrypted (for example after APP_ENCRYPTION_KEY changed)
// must not break keyword search.
async function readAiConnection(orgId: string): Promise<AiConnection | null> {
  try {
    return await getAiConnection(orgId);
  } catch (err) {
    console.warn(`Couldn't read the AI connection, so search uses keywords only: ${describeAiError(err)}`);
    return null;
  }
}

async function loadCandidates(
  orgId: string,
  projectId: string | null,
  now: Date,
  embeddingModel: string | null,
): Promise<Candidate[]> {
  // A project sees its own passages and those for all projects; no project means the whole org.
  const scope = projectId ? { OR: [{ projectId }, { projectId: null }] } : {};
  const validNow = { OR: [{ validUntil: null }, { validUntil: { gte: now } }] };
  // Vectors are only worth loading when there is a model to compare them with.
  const withVectors = embeddingModel !== null;
  const [chunks, qaPairs] = await Promise.all([
    prisma.chunk.findMany({
      where: {
        orgId,
        ...scope,
        // The source's own project is checked too, so passages left from an older run can't leak.
        source: { status: "ready", role: "reference", AND: [validNow, scope] },
      },
      select: {
        id: true,
        sourceId: true,
        projectId: true,
        page: true,
        heading: true,
        text: true,
        embedding: withVectors,
        embeddingModel: true,
        source: { select: { title: true, projectId: true, priority: true } },
      },
      orderBy: [{ sourceId: "asc" }, { ordinal: "asc" }],
    }),
    prisma.qaPair.findMany({
      where: { orgId, ...scope },
      select: { id: true, projectId: true, question: true, answer: true, embedding: withVectors, embeddingModel: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  // Vectors from another model live in a different space, so they are left out.
  const vectorOf = (row: { embedding?: Uint8Array | null; embeddingModel: string | null }) =>
    withVectors && row.embedding && row.embeddingModel === embeddingModel ? bytesToVector(row.embedding) : null;

  const documents = chunks.map(
    (chunk): Candidate => ({
      origin: "document",
      searchText: `${chunk.heading ?? ""}\n${chunk.text}`,
      vector: vectorOf(chunk),
      priority: chunk.source.priority,
      passage: {
        origin: "document",
        id: chunk.id,
        sourceId: chunk.sourceId,
        title: chunk.source.title,
        projectId: chunk.source.projectId,
        page: chunk.page,
        heading: chunk.heading,
        text: chunk.text,
      },
    }),
  );
  const answers = qaPairs.map(
    (qa): Candidate => ({
      origin: "qa",
      searchText: `${qa.question}\n${qa.answer}`,
      vector: vectorOf(qa),
      passage: {
        origin: "qa",
        id: qa.id,
        sourceId: null,
        title: qa.question,
        projectId: qa.projectId,
        page: null,
        heading: null,
        text: qa.answer,
      },
    }),
  );
  return [...documents, ...answers];
}

async function embedQuery(ai: AiConnection, model: string, query: string): Promise<Float32Array | null> {
  try {
    const endpoint = await checkEndpoint(ai.config.baseUrl);
    if (!endpoint.ok) return null;
    const client = createAiClient({ baseUrl: ai.config.baseUrl, apiKey: ai.apiKey, timeoutMs: QUERY_EMBED_TIMEOUT_MS });
    const [vector] = await embedTexts(client, model, [query], "query");
    return vector ?? null;
  } catch (err) {
    console.warn(`Couldn't embed the search question, so only keywords were used: ${describeAiError(err)}`);
    return null;
  }
}

/* ---------- Ranking (no database, so it can be tested on its own) ---------- */

/**
 * Ranks candidates for a query: BM25 over their text, plus cosine similarity when a query vector
 * is given, fused with reciprocal rank fusion. Candidates with no keyword match and only weak
 * similarity are dropped. Returns positions in `candidates`, best first.
 */
export function rankCandidates(
  query: string,
  candidates: RankInput[],
  opts: { queryVector?: Float32Array | null; limit?: number } = {},
): Ranked[] {
  const priorities = candidates.map((c) => c.priority ?? 0);
  let byMeaning: number[] = [];
  const queryVector = opts.queryVector;
  if (queryVector) {
    const similarities = candidates.map((c) => (c.vector ? cosineSimilarity(queryVector, c.vector) : -Infinity));
    const floor = similarityFloor(similarities);
    byMeaning = rankBy(similarities, (similarity) => similarity >= floor, priorities);
  }
  const meaningSet = new Set(byMeaning);

  const terms = [...new Set(tokenize(query))];
  const docs = candidates.map((c) => tokenize(c.searchText));
  const keywordScores = bm25Scores(terms, docs);
  const best = keywordScores.reduce((max, score) => Math.max(max, score), 0);
  const strongKeywordMatch = (i: number) => {
    const words = new Set(docs[i]);
    const coverage = terms.filter((term) => words.has(term)).length / terms.length;
    return coverage === 1 || (coverage >= MIN_KEYWORD_COVERAGE && keywordScores[i] >= best * MIN_KEYWORD_SHARE);
  };
  // A weak keyword match still counts when meaning backs it up.
  const byKeywords = rankBy(
    keywordScores,
    (score, i) => score > 0 && (meaningSet.has(i) || strongKeywordMatch(i)),
    priorities,
  );
  const keywordSet = new Set(byKeywords);
  const ranked: Ranked[] = [];
  for (const [index, fused] of reciprocalRankFusion([byKeywords, byMeaning])) {
    const matchedBy: Passage["matchedBy"] = [];
    if (keywordSet.has(index)) matchedBy.push("keywords");
    if (meaningSet.has(index)) matchedBy.push("meaning");
    const { origin, priority = 0 } = candidates[index];
    const steps = Math.max(-MAX_PRIORITY_STEPS, Math.min(MAX_PRIORITY_STEPS, priority));
    const score = fused * (origin === "qa" ? QA_BOOST : 1) * (1 + steps * PRIORITY_STEP);
    ranked.push({ index, score, matchedBy });
  }
  return ranked.sort((a, b) => b.score - a.score || a.index - b.index).slice(0, Math.max(0, opts.limit ?? DEFAULT_LIMIT));
}

/** BM25 relevance of each tokenized document to the query terms; 0 when no term matches. */
export function bm25Scores(queryTokens: string[], docs: string[][], k1 = BM25_K1, b = BM25_B): number[] {
  const terms = new Set(queryTokens);
  if (terms.size === 0 || docs.length === 0) return docs.map(() => 0);
  const averageLength = docs.reduce((sum, doc) => sum + doc.length, 0) / docs.length || 1;
  const frequencies = docs.map((doc) => {
    const counts = new Map<string, number>();
    for (const token of doc) if (terms.has(token)) counts.set(token, (counts.get(token) ?? 0) + 1);
    return counts;
  });
  const idf = new Map<string, number>();
  for (const term of terms) {
    const found = frequencies.reduce((n, counts) => n + (counts.has(term) ? 1 : 0), 0);
    // This form never goes negative, so a word in most passages still counts for a little.
    idf.set(term, Math.log(1 + (docs.length - found + 0.5) / (found + 0.5)));
  }
  return docs.map((doc, i) => {
    let score = 0;
    for (const [term, tf] of frequencies[i]) {
      score += ((idf.get(term) ?? 0) * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * doc.length) / averageLength));
    }
    return score;
  });
}

/** Reciprocal rank fusion: every ranking a candidate appears in adds 1 / (k + its rank). */
export function reciprocalRankFusion(rankings: number[][], k = RRF_K): Map<number, number> {
  const fused = new Map<number, number>();
  for (const ranking of rankings) {
    ranking.forEach((index, rank) => fused.set(index, (fused.get(index) ?? 0) + 1 / (k + rank + 1)));
  }
  return fused;
}

/** The similarity a candidate needs to count as a meaning match for this query. */
export function similarityFloor(similarities: number[]): number {
  const best = similarities.reduce((max, similarity) => Math.max(max, similarity), -Infinity);
  return Math.max(MIN_SIMILARITY, best - SIMILARITY_SPREAD);
}

// Positions of the kept scores, highest first; ties go to the higher priority, then the original order.
function rankBy(scores: number[], keep: (score: number, index: number) => boolean, priorities: number[]): number[] {
  return scores
    .flatMap((score, index) => (keep(score, index) ? [index] : []))
    .sort((a, b) => scores[b] - scores[a] || priorities[b] - priorities[a] || a - b);
}
