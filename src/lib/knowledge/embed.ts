import type OpenAI from "openai";

// Small enough for local servers, which often embed one request at a time.
const BATCH_SIZE = 32;

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

// Some embedding models are trained with task prefixes and match noticeably worse without them.
function taskPrefix(model: string, kind: "document" | "query"): string {
  const id = model.toLowerCase();
  if (id.includes("nomic")) return kind === "document" ? "search_document: " : "search_query: ";
  if (/(^|[^a-z0-9])e5([^a-z0-9]|$)/.test(id)) return kind === "document" ? "passage: " : "query: ";
  return "";
}

/**
 * Embeds texts with the customer's embedding model, in batches. `kind` adds the prefixes some
 * models expect (for example nomic-embed: "search_document: " / "search_query: ").
 */
export async function embedTexts(
  client: OpenAI,
  model: string,
  texts: string[],
  kind: "document" | "query",
): Promise<Float32Array[]> {
  const prefix = taskPrefix(model, kind);
  const vectors: Float32Array[] = [];
  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    const batch = texts.slice(start, start + BATCH_SIZE);
    const response = await client.embeddings.create({
      model,
      input: batch.map((text) => prefix + text),
      encoding_format: "float",
    });
    // Servers are meant to answer in order, but each item says where it belongs.
    const data = [...response.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (data.length !== batch.length) {
      throw new Error(`The server returned ${data.length} embeddings for ${batch.length} texts.`);
    }
    for (const item of data) vectors.push(toVector(item.embedding));
  }
  return vectors;
}

function toVector(embedding: unknown): Float32Array {
  // A few compatible servers answer in base64 whatever was asked for.
  if (typeof embedding === "string" && embedding) return bytesToVector(Buffer.from(embedding, "base64"));
  if (Array.isArray(embedding) && embedding.length > 0) return Float32Array.from(embedding as number[]);
  throw new Error("The server returned an empty embedding.");
}

/** Packs a vector into bytes for the Prisma `Bytes` column. */
export function vectorToBytes(vector: Float32Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(vector.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < vector.length; i++) view.setFloat32(i * 4, vector[i], true);
  return bytes;
}

/** Unpacks bytes from the Prisma `Bytes` column into a vector. */
export function bytesToVector(bytes: Uint8Array): Float32Array {
  if (bytes.byteLength % 4 !== 0) throw new Error("A stored embedding has an invalid length.");
  if (LITTLE_ENDIAN) {
    // Copy first: a Buffer may sit at any offset inside a shared pool, and Float32Array needs alignment.
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return new Float32Array(copy.buffer);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const vector = new Float32Array(bytes.byteLength / 4);
  for (let i = 0; i < vector.length; i++) vector[i] = view.getFloat32(i * 4, true);
  return vector;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  // Vectors of different sizes come from different models and can't be compared.
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return normA === 0 || normB === 0 ? 0 : dot / Math.sqrt(normA * normB);
}
