import assert from "node:assert/strict";
import { test } from "node:test";
import type OpenAI from "openai";
import { bytesToVector, cosineSimilarity, embedTexts, vectorToBytes } from "./embed";

type EmbeddingRequest = { model: string; input: string[]; encoding_format?: string };

// Stands in for the AI server: each text's embedding is [its length, its place in the batch],
// sent back in reverse order to check that results are put back in place.
function fakeClient(requests: EmbeddingRequest[]) {
  const create = async (body: EmbeddingRequest) => {
    requests.push(body);
    const data = body.input.map((text, index) => ({ object: "embedding", index, embedding: [text.length, index] }));
    return { object: "list", model: body.model, data: data.reverse(), usage: { prompt_tokens: 0, total_tokens: 0 } };
  };
  return { embeddings: { create } } as unknown as OpenAI;
}

test("vectors survive the trip through bytes", () => {
  const vector = new Float32Array([0.5, -1.25, 3.4028234663852886e38, 1e-7, 0]);
  const bytes = vectorToBytes(vector);
  assert.equal(bytes.byteLength, 20);
  assert.deepEqual(bytesToVector(bytes), vector);
  // Little-endian, whatever the machine.
  assert.deepEqual(Array.from(vectorToBytes(new Float32Array([1]))), [0, 0, 128, 63]);
  // Buffers from the database can start at any offset inside a larger pool.
  const pool = Buffer.alloc(bytes.byteLength + 3);
  pool.set(bytes, 3);
  assert.deepEqual(bytesToVector(pool.subarray(3)), vector);
  assert.throws(() => bytesToVector(new Uint8Array(5)));
});

test("cosine similarity", () => {
  const a = new Float32Array([1, 2, 3]);
  assert.ok(Math.abs(cosineSimilarity(a, new Float32Array([2, 4, 6])) - 1) < 1e-6);
  assert.ok(Math.abs(cosineSimilarity(a, new Float32Array([-1, -2, -3])) + 1) < 1e-6);
  assert.equal(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([0, 1])), 0);
  // Vectors from different models, and empty ones, don't compare.
  assert.equal(cosineSimilarity(a, new Float32Array([1, 2])), 0);
  assert.equal(cosineSimilarity(a, new Float32Array(3)), 0);
});

test("embeds in batches of 32 and keeps the results in order", async () => {
  const requests: EmbeddingRequest[] = [];
  const texts = Array.from({ length: 70 }, (_, i) => `text ${i}`);
  const vectors = await embedTexts(fakeClient(requests), "text-embedding-3-small", texts, "document");
  assert.deepEqual(
    requests.map((r) => r.input.length),
    [32, 32, 6],
  );
  assert.ok(requests.every((r) => r.model === "text-embedding-3-small" && r.encoding_format === "float"));
  assert.equal(vectors.length, 70);
  assert.deepEqual(Array.from(vectors[33]), ["text 33".length, 1]);
  assert.deepEqual(await embedTexts(fakeClient(requests), "text-embedding-3-small", [], "query"), []);
  assert.equal(requests.length, 3);
});

test("adds the task prefixes nomic and e5 models expect", async () => {
  const sent = async (model: string, kind: "document" | "query") => {
    const requests: EmbeddingRequest[] = [];
    await embedTexts(fakeClient(requests), model, ["سعر الشقة"], kind);
    return requests[0].input[0];
  };
  assert.equal(await sent("text-embedding-nomic-embed-text-v1.5", "document"), "search_document: سعر الشقة");
  assert.equal(await sent("nomic-embed-text", "query"), "search_query: سعر الشقة");
  assert.equal(await sent("intfloat/multilingual-e5-large", "document"), "passage: سعر الشقة");
  assert.equal(await sent("text-embedding-multilingual-e5-small", "query"), "query: سعر الشقة");
  assert.equal(await sent("text-embedding-3-small", "query"), "سعر الشقة");
  assert.equal(await sent("bge-m3", "document"), "سعر الشقة");
});
