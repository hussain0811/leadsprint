import OpenAI from "openai";
import type { KnowledgeSource, Prisma } from "@/generated/prisma/client";
import { createAiClient, describeAiError } from "../ai/client";
import { getAiConnection } from "../connections";
import { prisma } from "../db";
import { checkEndpoint } from "../net";
import { getStorage } from "../storage";
import { chunkPages } from "./chunk";
import { embedTexts, vectorToBytes } from "./embed";
import { extractText } from "./extract";
import { fetchWebPage, PageFetchError } from "./fetch-page";
import { failedEmbeddingMarker, needsEmbeddingWhere, rulesCharsUsed } from "./queries";
import { ExtractError, RULES_CHAR_LIMIT, type ExtractedPage, type SourceRole } from "./types";

// Saved in small batches so a long document keeps its progress if the AI server stops halfway.
const EMBED_BATCH = 32;
// Embedding models read a limited number of tokens; longer input is cut rather than refused.
const MAX_EMBED_CHARS = 2_000;
// Pages are stored separated by form feeds, so passages can be rebuilt from the stored text with their page numbers.
const PAGE_BREAK = "\n\f\n";

// Thrown with a message meant for the admin.
class IngestError extends Error {}

type Content = { pages: ExtractedPage[]; title: string | null };
type Embedder = { client: OpenAI; model: string };
type Tx = Prisma.TransactionClient;

const formatCount = (n: number) => n.toLocaleString("en-US");
const isActive = (validUntil: Date | null, now: Date) => !validUntil || validUntil >= now;

export function rulesCapMessage(total: number) {
  return `Rules documents can add up to ${formatCount(RULES_CHAR_LIMIT)} characters in total (about 10 pages), because they are sent with every AI reply. With this one they would add up to ${formatCount(total)}. Shorten it, or make it a reference document.`;
}

// Would this rules document push the org's active rules over the cap?
async function rulesOverCap(tx: Tx, source: { id: string; orgId: string; validUntil: Date | null }, chars: number, now: Date) {
  if (!isActive(source.validUntil, now)) return null;
  const total = (await rulesCharsUsed(tx, source.orgId, { exceptId: source.id, now })) + chars;
  return total > RULES_CHAR_LIMIT ? total : null;
}

/* ---------- Processing ---------- */

/**
 * Reads a source again from its file, page or text, and makes it searchable (reference) or
 * checks it against the rules size limit (rules). Never throws: problems end up on the source
 * as status "failed" with a message for the admin.
 */
export async function ingestSource(sourceId: string): Promise<void> {
  try {
    await processSource(sourceId);
  } catch (err) {
    try {
      // A failed source is left out of search, so drop its old passages too.
      await prisma.$transaction([
        prisma.chunk.deleteMany({ where: { sourceId } }),
        prisma.knowledgeSource.updateMany({
          where: { id: sourceId },
          data: { status: "failed", error: describeError(err), embeddingModel: null },
        }),
      ]);
    } catch (saveErr) {
      console.error(`Couldn't record that knowledge source ${sourceId} failed:`, saveErr);
    }
  }
}

async function processSource(sourceId: string) {
  const source = await prisma.knowledgeSource.findUnique({ where: { id: sourceId } });
  if (!source) return;
  // charCount is left as it was, so the rules cap keeps counting this source at its previous size meanwhile.
  await prisma.knowledgeSource.update({ where: { id: sourceId }, data: { status: "processing", error: null } });

  const content = await readContent(source);
  const text = joinPages(content.pages);
  if (!text.trim()) throw new IngestError("No readable text was found.");
  const pageNumbers = content.pages.map((p) => p.page).filter((p): p is number => p !== null);

  await storeContent(source, source.role as SourceRole, {
    text,
    charCount: text.length,
    pageCount: pageNumbers.length ? Math.max(...pageNumbers) : null,
    // A page added without a title is named after the page itself.
    ...(source.kind === "url" && source.title === source.url && content.title
      ? { title: content.title.slice(0, 200) }
      : {}),
  });
}

type StoredFields = { text: string; charCount: number; pageCount: number | null; title?: string };

// Saves the text, then either checks the rules cap (rules) or rebuilds the passages (reference).
async function storeContent(
  source: Pick<KnowledgeSource, "id" | "orgId" | "projectId" | "validUntil">,
  role: SourceRole,
  fields: StoredFields,
  extra: Prisma.KnowledgeSourceUncheckedUpdateInput = {},
) {
  const sourceId = source.id;
  const data = { ...extra, ...fields, role, embeddingModel: null };

  if (role === "rules") {
    // Rules go whole into every AI reply, so they have no passages. The cap check and the status
    // write share one transaction so two rules documents saved at once can't both slip under it.
    // The text is kept even when it is too long, so the admin can see what was read.
    await prisma.$transaction(async (tx) => {
      const over = await rulesOverCap(tx, source, fields.charCount, new Date());
      await tx.chunk.deleteMany({ where: { sourceId } });
      await tx.knowledgeSource.update({
        where: { id: sourceId },
        data: { ...data, status: over ? "failed" : "ready", error: over ? rulesCapMessage(over) : null },
      });
    });
    return;
  }

  const drafts = chunkPages(pagesFromText(fields.text, fields.pageCount));
  if (drafts.length === 0) throw new IngestError("No readable text was found.");
  const projectId = typeof extra.projectId === "string" || extra.projectId === null ? extra.projectId : source.projectId;
  await prisma.$transaction([
    prisma.chunk.deleteMany({ where: { sourceId } }),
    prisma.chunk.createMany({
      data: drafts.map((d) => ({
        orgId: source.orgId,
        projectId,
        sourceId,
        ordinal: d.ordinal,
        heading: d.heading,
        page: d.page,
        text: d.text,
      })),
    }),
    prisma.knowledgeSource.update({ where: { id: sourceId }, data: { ...data, status: "ready", error: null } }),
  ]);
  await embedSource(source.orgId, sourceId);
}

function joinPages(pages: ExtractedPage[]) {
  const numbered = pages.length > 1 && pages.every((p, i) => p.page === i + 1);
  if (numbered) return pages.map((p) => p.text.trim()).join(PAGE_BREAK);
  return pages
    .map((p) => p.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

function pagesFromText(text: string, pageCount: number | null): ExtractedPage[] {
  if (text.includes("\f")) return text.split(/\n?\f\n?/).map((t, i) => ({ page: i + 1, text: t }));
  return [{ page: pageCount === 1 ? 1 : null, text }];
}

async function readContent(source: KnowledgeSource): Promise<Content> {
  switch (source.kind) {
    case "file": {
      if (!source.storageKey || !source.fileName) {
        throw new IngestError("The file for this source wasn't saved. Upload it again.");
      }
      const storage = await getStorage(source.orgId);
      const buffer = await storage.get(source.storageKey);
      return extractText({ buffer, fileName: source.fileName, mimeType: source.mimeType });
    }
    case "url": {
      if (!source.url) throw new IngestError("This source has no web address.");
      const page = await fetchWebPage(source.url);
      return { pages: [{ page: null, text: page.text }], title: page.title };
    }
    case "text":
      return { pages: [{ page: null, text: source.text ?? "" }], title: null };
    default:
      throw new IngestError(`Unknown source type "${source.kind}".`);
  }
}

export const MISSING_FILE =
  "The original file is missing from storage. Check the storage folder in Connections, then reprocess this document.";

function describeError(err: unknown): string {
  if (err instanceof ExtractError || err instanceof PageFetchError || err instanceof IngestError) return err.message;
  if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return MISSING_FILE;
  console.error("Knowledge source processing failed:", err);
  // Unexpected errors can be long and technical; the first line is enough for the admin.
  const message = err instanceof Error ? err.message.split("\n")[0].trim() : "";
  return message.slice(0, 300) || "Processing failed for an unknown reason.";
}

/* ---------- Edits ---------- */

export type SourceChanges = {
  title?: string;
  role?: SourceRole;
  projectId?: string | null;
  validUntil?: Date | null;
  priority?: number;
};

/**
 * Applies an edit from what is already stored; only Reprocess reads the original again.
 * A new project moves the passages with the source; a new role rebuilds them from the stored text.
 * Returns an error message when the edit would push the rules over the cap, before anything changes.
 */
export async function editSource(orgId: string, id: string, changes: SourceChanges): Promise<{ error: string } | null> {
  const source = await prisma.knowledgeSource.findFirst({ where: { id, orgId } });
  if (!source) return null;
  const now = new Date();
  const role = changes.role ?? (source.role as SourceRole);
  const validUntil = changes.validUntil !== undefined ? changes.validUntil : source.validUntil;
  const rebuild = role !== source.role && Boolean(source.text);

  // A rules document starts counting toward the cap when it becomes rules or its date moves past today.
  const wasCounted = source.role === "rules" && source.status === "ready" && isActive(source.validUntil, now);
  const willCount = role === "rules" && (rebuild || source.status === "ready") && isActive(validUntil, now);
  if (willCount && !wasCounted) {
    const over = await rulesOverCap(prisma, { ...source, validUntil }, source.charCount, now);
    if (over) return { error: rulesCapMessage(over) };
  }

  if (!rebuild) {
    await prisma.$transaction([
      prisma.knowledgeSource.update({ where: { id }, data: changes }),
      ...(changes.projectId !== undefined && changes.projectId !== source.projectId
        ? [prisma.chunk.updateMany({ where: { sourceId: id }, data: { projectId: changes.projectId } })]
        : []),
    ]);
    return null;
  }

  const fields = { text: source.text!, charCount: source.charCount, pageCount: source.pageCount };
  try {
    await storeContent({ ...source, validUntil }, role, fields, changes);
  } catch (err) {
    return { error: describeError(err) };
  }
  return null;
}

/* ---------- Embeddings ---------- */

// The client and model for embedding, or why embedding can't run for this org.
async function getEmbedder(orgId: string): Promise<{ embedder: Embedder } | { skipped: string }> {
  const ai = await getAiConnection(orgId);
  if (!ai) return { skipped: "Connect an AI model in Connections to search by meaning." };
  const model = ai.config.embeddingModel;
  if (!model) return { skipped: "Choose an embedding model in Connections to search by meaning." };
  const endpoint = await checkEndpoint(ai.config.baseUrl);
  if (!endpoint.ok) return { skipped: endpoint.reason };
  const client = createAiClient({ baseUrl: ai.config.baseUrl, apiKey: ai.apiKey, timeoutMs: 60_000 });
  return { embedder: { client, model } };
}

// Keyword search already works, so an embedding problem leaves the source ready.
async function embedSource(orgId: string, sourceId: string) {
  try {
    const setup = await getEmbedder(orgId);
    if (!("embedder" in setup)) return;
    const { failed } = await embedChunks(setup.embedder, { sourceId });
    if (failed === 0) {
      await prisma.knowledgeSource.updateMany({ where: { id: sourceId }, data: { embeddingModel: setup.embedder.model } });
    }
  } catch (err) {
    console.warn(`Couldn't embed knowledge source ${sourceId}: ${describeAiError(err)}`);
  }
}

// The heading gives a passage that starts mid-section its context.
function chunkInput(chunk: { heading: string | null; text: string }) {
  return chunk.heading && !chunk.text.includes(chunk.heading) ? `${chunk.heading}\n${chunk.text}` : chunk.text;
}

// A refusal about the text itself (too long, unreadable) rather than the server being unreachable or busy.
function isPassageProblem(err: unknown) {
  if (err instanceof OpenAI.APIError) return err.status === 400 || err.status === 413 || err.status === 422;
  return !(err instanceof Error && err.name === "AbortError");
}

type EmbedData = { embedding: Uint8Array<ArrayBuffer> | null; embeddingModel: string };

// Embeds batch after batch until none is left; each batch is saved before the next is sent. When a
// batch fails, its passages are tried one at a time, and those the model still refuses are marked
// so the loop moves on. Server problems stop the run and are thrown.
async function embedAll<Row extends { id: string }>(
  { client, model }: Embedder,
  nextBatch: () => Promise<Row[]>,
  inputFor: (row: Row) => string,
  save: (id: string, data: EmbedData) => Prisma.PrismaPromise<unknown>,
): Promise<{ embedded: number; failed: number }> {
  let embedded = 0;
  let failed = 0;
  const embed = async (inputs: string[]) => {
    const vectors = await embedTexts(client, model, inputs, "document");
    if (vectors.length !== inputs.length) throw new Error("The server returned a different number of embeddings than asked for.");
    return vectors;
  };

  for (;;) {
    const rows = await nextBatch();
    if (rows.length === 0) return { embedded, failed };
    const inputs = rows.map((row) => inputFor(row).slice(0, MAX_EMBED_CHARS));

    let vectors: Array<Float32Array | null>;
    try {
      vectors = await embed(inputs);
    } catch (batchErr) {
      if (!isPassageProblem(batchErr)) throw batchErr;
      vectors = [];
      for (const input of inputs) {
        try {
          vectors.push((await embed([input]))[0]);
        } catch (err) {
          if (!isPassageProblem(err)) throw err;
          vectors.push(null);
        }
      }
    }

    await prisma.$transaction(
      rows.map((row, i) => {
        const vector = vectors[i];
        return save(
          row.id,
          vector ? { embedding: vectorToBytes(vector), embeddingModel: model } : { embedding: null, embeddingModel: failedEmbeddingMarker(model) },
        );
      }),
    );
    const ok = vectors.filter(Boolean).length;
    embedded += ok;
    failed += rows.length - ok;
  }
}

// updateMany in both savers, because a row may be deleted while this runs (its source reprocessed, say).
function embedChunks(embedder: Embedder, where: Prisma.ChunkWhereInput) {
  return embedAll(
    embedder,
    () =>
      prisma.chunk.findMany({
        where: { AND: [where, needsEmbeddingWhere(embedder.model)] },
        select: { id: true, heading: true, text: true },
        orderBy: { id: "asc" },
        take: EMBED_BATCH,
      }),
    chunkInput,
    (id, data) => prisma.chunk.updateMany({ where: { id }, data }),
  );
}

function embedQaPairs(embedder: Embedder, where: Prisma.QaPairWhereInput) {
  return embedAll(
    embedder,
    () =>
      prisma.qaPair.findMany({
        where: { AND: [where, needsEmbeddingWhere(embedder.model)] },
        select: { id: true, question: true, answer: true },
        orderBy: { id: "asc" },
        take: EMBED_BATCH,
      }),
    (qa) => `${qa.question}\n${qa.answer}`,
    (id, data) => prisma.qaPair.updateMany({ where: { id }, data }),
  );
}

/**
 * Embeds every reference passage and Q&A pair that has no embedding from the current embedding
 * model, for example after the model changed. Throws on AI server errors; work done before the
 * error is kept.
 */
export async function embedPendingChunks(orgId: string): Promise<{ embedded: number; skipped: string | null }> {
  const setup = await getEmbedder(orgId);
  if ("skipped" in setup) return { embedded: 0, skipped: setup.skipped };
  const { model } = setup.embedder;

  const chunks = await embedChunks(setup.embedder, { orgId, source: { role: "reference" } });
  if (chunks.embedded > 0 && chunks.failed === 0) {
    await prisma.knowledgeSource.updateMany({
      where: { orgId, role: "reference", status: "ready" },
      data: { embeddingModel: model },
    });
  }
  const qaPairs = await embedQaPairs(setup.embedder, { orgId });

  const embedded = chunks.embedded + qaPairs.embedded;
  const failed = chunks.failed + qaPairs.failed;
  const skipped = failed
    ? `The model couldn't embed ${formatCount(failed)} passage${failed === 1 ? "" : "s"}; keyword search still finds them.`
    : embedded === 0
      ? "Every passage already has an embedding."
      : null;
  return { embedded, skipped };
}

// Embeds one Q&A pair right after it is saved. Keyword search still finds it if this fails.
export async function embedQaPair(orgId: string, id: string): Promise<void> {
  try {
    const setup = await getEmbedder(orgId);
    if ("embedder" in setup) await embedQaPairs(setup.embedder, { id, orgId });
  } catch (err) {
    console.warn(`Couldn't embed Q&A pair ${id}: ${describeAiError(err)}`);
  }
}
