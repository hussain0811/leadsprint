import type { Prisma } from "@/generated/prisma/client";
import { findConnection, readAiConfig, readStorageConfig } from "../connections";
import { prisma } from "../db";
import {
  RULES_CHAR_LIMIT,
  type KnowledgeOverview,
  type KnowledgeSourceView,
  type QaPairView,
  type SourceDetail,
  type SourceKind,
  type SourceRole,
  type SourceStatus,
} from "./types";

// Page breaks are stored as form feeds (see ingest.ts); the preview leaves them out.
const TEXT_PREVIEW_CHARS = 4_000;

// Everything a source view needs except the full text, which can run to megabytes.
export const sourceSelect = {
  id: true,
  kind: true,
  role: true,
  title: true,
  projectId: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  url: true,
  status: true,
  error: true,
  validUntil: true,
  priority: true,
  charCount: true,
  pageCount: true,
  createdAt: true,
  updatedAt: true,
  project: { select: { name: true } },
} satisfies Prisma.KnowledgeSourceSelect;

export type SourceRow = Prisma.KnowledgeSourceGetPayload<{ select: typeof sourceSelect }>;

export const qaSelect = {
  id: true,
  projectId: true,
  question: true,
  answer: true,
  embeddingModel: true,
  updatedAt: true,
  project: { select: { name: true } },
} satisfies Prisma.QaPairSelect;

export type QaRow = Prisma.QaPairGetPayload<{ select: typeof qaSelect }>;

export type ChunkCounts = { chunkCount: number; embeddedCount: number };

// Marks a passage the model refused to embed, so catch-up runs move on. Neither embedded nor pending.
export function failedEmbeddingMarker(model: string) {
  return `failed:${model}`;
}

// Passages with no embedding from the current model: never embedded, or embedded by a model used before.
export function needsEmbeddingWhere(model: string) {
  return {
    OR: [{ embeddingModel: null }, { embeddingModel: { notIn: [model, failedEmbeddingMarker(model)] } }],
  };
}

const INTERRUPTED_AFTER_MS = 5 * 60_000;
export const INTERRUPTED = "Processing was interrupted. Reprocess it.";

// Processing runs inside one request, so a source still "processing" after five minutes was cut off
// (a server restart, say). Marking it failed lets the admin reprocess it.
export async function failInterrupted(orgId: string, now = new Date()) {
  await prisma.knowledgeSource.updateMany({
    where: { orgId, status: "processing", updatedAt: { lt: new Date(now.getTime() - INTERRUPTED_AFTER_MS) } },
    data: { status: "failed", error: INTERRUPTED },
  });
}

type Db = Pick<typeof prisma, "knowledgeSource">;

// Rules in use: ready ones, plus ones being processed counted at their previous size. Expired rules
// aren't sent to the AI, so they don't count.
export async function rulesCharsUsed(db: Db, orgId: string, opts: { exceptId?: string; now?: Date } = {}) {
  const result = await db.knowledgeSource.aggregate({
    where: {
      orgId,
      role: "rules",
      status: { in: ["ready", "processing"] },
      OR: [{ validUntil: null }, { validUntil: { gte: opts.now ?? new Date() } }],
      ...(opts.exceptId ? { id: { not: opts.exceptId } } : {}),
    },
    _sum: { charCount: true },
  });
  return result._sum.charCount ?? 0;
}

// The rules the AI follows for a project: the org-wide ones plus that project's, ready and not expired.
export function getActiveRules(orgId: string, projectId: string | null, now = new Date()) {
  return prisma.knowledgeSource.findMany({
    where: {
      orgId,
      role: "rules",
      status: "ready",
      AND: [
        { OR: [{ projectId: null }, ...(projectId ? [{ projectId }] : [])] },
        { OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
      ],
    },
    select: { title: true, text: true },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
  });
}

// Dates are stored as the end of the day they name; views show just that day.
export function dateOnly(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : null;
}

export function toSourceView(row: SourceRow, counts: ChunkCounts): KnowledgeSourceView {
  return {
    id: row.id,
    kind: row.kind as SourceKind,
    role: row.role as SourceRole,
    title: row.title,
    projectId: row.projectId,
    projectName: row.project?.name ?? null,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    url: row.url,
    status: row.status as SourceStatus,
    error: row.error,
    validUntil: dateOnly(row.validUntil),
    priority: row.priority,
    charCount: row.charCount,
    pageCount: row.pageCount,
    chunkCount: counts.chunkCount,
    embeddedCount: counts.embeddedCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toQaView(row: QaRow, embeddingModel: string | null): QaPairView {
  return {
    id: row.id,
    projectId: row.projectId,
    projectName: row.project?.name ?? null,
    question: row.question,
    answer: row.answer,
    embedded: Boolean(embeddingModel) && row.embeddingModel === embeddingModel,
    updatedAt: row.updatedAt.toISOString(),
  };
}

// The AI connection's embedding model, or null when there is no connection or no model chosen.
export async function getEmbeddingModel(orgId: string): Promise<string | null> {
  const row = await findConnection(orgId, "ai");
  return (row && readAiConfig(row)?.embeddingModel) || null;
}

export function findProject(orgId: string, projectId: string) {
  return prisma.project.findFirst({ where: { id: projectId, orgId }, select: { id: true } });
}

async function countChunks(sourceId: string, model: string | null): Promise<ChunkCounts> {
  const [chunkCount, embeddedCount] = await Promise.all([
    prisma.chunk.count({ where: { sourceId } }),
    model ? prisma.chunk.count({ where: { sourceId, embeddingModel: model } }) : 0,
  ]);
  return { chunkCount, embeddedCount };
}

export async function getSourceView(orgId: string, id: string): Promise<KnowledgeSourceView | null> {
  await failInterrupted(orgId);
  const [row, model] = await Promise.all([
    prisma.knowledgeSource.findFirst({ where: { id, orgId }, select: sourceSelect }),
    getEmbeddingModel(orgId),
  ]);
  return row && toSourceView(row, await countChunks(id, model));
}

export async function getSourceDetail(orgId: string, id: string): Promise<SourceDetail | null> {
  await failInterrupted(orgId);
  const [row, model] = await Promise.all([
    prisma.knowledgeSource.findFirst({ where: { id, orgId }, select: { ...sourceSelect, text: true } }),
    getEmbeddingModel(orgId),
  ]);
  if (!row) return null;
  const [chunks, counts] = await Promise.all([
    prisma.chunk.findMany({
      where: { sourceId: id },
      orderBy: { ordinal: "asc" },
      select: { ordinal: true, page: true, heading: true, text: true },
    }),
    countChunks(id, model),
  ]);
  return { ...toSourceView(row, counts), textPreview: (row.text ?? "").replace(/\f/g, "").slice(0, TEXT_PREVIEW_CHARS), chunks };
}

export async function getQaView(orgId: string, id: string): Promise<QaPairView | null> {
  const [row, model] = await Promise.all([
    prisma.qaPair.findFirst({ where: { id, orgId }, select: qaSelect }),
    getEmbeddingModel(orgId),
  ]);
  return row && toQaView(row, model);
}

export async function getKnowledgeOverview(orgId: string): Promise<KnowledgeOverview> {
  const [aiRow, storageRow] = await Promise.all([findConnection(orgId, "ai"), findConnection(orgId, "storage")]);
  const aiConfig = aiRow && readAiConfig(aiRow);
  const model = aiConfig?.embeddingModel || null;
  await failInterrupted(orgId);

  const [sources, qaRows, projects, chunkTotals, embeddedTotals, rulesUsed, pendingChunks, pendingQa] = await Promise.all([
    prisma.knowledgeSource.findMany({ where: { orgId }, select: sourceSelect, orderBy: { createdAt: "desc" } }),
    prisma.qaPair.findMany({ where: { orgId }, select: qaSelect, orderBy: { createdAt: "desc" } }),
    prisma.project.findMany({ where: { orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.chunk.groupBy({ by: ["sourceId"], where: { orgId }, _count: { _all: true } }),
    model
      ? prisma.chunk.groupBy({ by: ["sourceId"], where: { orgId, embeddingModel: model }, _count: { _all: true } })
      : Promise.resolve([]),
    rulesCharsUsed(prisma, orgId),
    model
      ? prisma.chunk.count({ where: { orgId, source: { role: "reference" }, ...needsEmbeddingWhere(model) } })
      : 0,
    model ? prisma.qaPair.count({ where: { orgId, ...needsEmbeddingWhere(model) } }) : 0,
  ]);

  const chunkCount = new Map(chunkTotals.map((g) => [g.sourceId, g._count._all]));
  const embeddedCount = new Map(embeddedTotals.map((g) => [g.sourceId, g._count._all]));
  const qaPairs = qaRows.map((row) => toQaView(row, model));
  const anyEmbedded = embeddedCount.size > 0 || qaPairs.some((qa) => qa.embedded);

  const storageConfig = storageRow?.provider === "local_folder" ? readStorageConfig(storageRow) : null;

  return {
    sources: sources.map((row) =>
      toSourceView(row, { chunkCount: chunkCount.get(row.id) ?? 0, embeddedCount: embeddedCount.get(row.id) ?? 0 }),
    ),
    qaPairs,
    projects,
    rules: { usedChars: rulesUsed, limitChars: RULES_CHAR_LIMIT },
    search: {
      // Meaning search needs both a model and passages already embedded with it.
      mode: model && anyEmbedded ? "hybrid" : "keywords",
      embeddingModel: model,
      needsEmbedding: pendingChunks + pendingQa,
    },
    storageReady: Boolean(storageConfig) && storageRow?.status !== "error",
    aiReady: Boolean(aiConfig),
  };
}
