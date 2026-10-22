// Shared contract for the knowledge base: the core library, the API routes and the Knowledge page
// all build against these types. Keep this file free of server-only imports; the browser imports it too.

export type SourceKind = "file" | "url" | "text";
// Reference documents are searched when a question needs them; rules apply to every AI reply.
export type SourceRole = "reference" | "rules";
export type SourceStatus = "processing" | "ready" | "failed";

// Rules are sent with every AI reply, so their combined size is capped (about 10 pages).
export const RULES_CHAR_LIMIT = 24_000;
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".xlsx", ".csv", ".txt", ".md"] as const;

/* ---------- Core library ---------- */

export type ExtractedPage = { page: number | null; text: string };
export type ExtractResult = { pages: ExtractedPage[]; title: string | null };

// Thrown by extraction with a message that is safe and useful to show the admin.
export class ExtractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractError";
  }
}

export type ChunkDraft = { ordinal: number; heading: string | null; page: number | null; text: string };

export type Passage = {
  origin: "document" | "qa";
  id: string; // chunk id, or QA pair id
  sourceId: string | null; // knowledge source id for document passages
  title: string; // source title, or the QA question
  projectId: string | null;
  page: number | null;
  heading: string | null;
  text: string; // chunk text, or the QA answer
  score: number; // fused relevance, higher is better
  matchedBy: Array<"keywords" | "meaning">;
};

export type SearchMode = "hybrid" | "keywords";
export type SearchResult = { passages: Passage[]; mode: SearchMode; embeddingModel: string | null };

/* ---------- API shapes (route handlers <-> Knowledge page) ---------- */

export type ProjectOption = { id: string; name: string };

export type KnowledgeSourceView = {
  id: string;
  kind: SourceKind;
  role: SourceRole;
  title: string;
  projectId: string | null; // null = all projects
  projectName: string | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  url: string | null;
  status: SourceStatus;
  error: string | null;
  validUntil: string | null; // ISO date
  priority: number;
  charCount: number;
  pageCount: number | null;
  chunkCount: number;
  embeddedCount: number; // passages with an embedding from the current embedding model
  createdAt: string;
  updatedAt: string;
};

export type SourceDetail = KnowledgeSourceView & {
  textPreview: string; // first ~4,000 characters of the extracted text
  chunks: Array<{ ordinal: number; page: number | null; heading: string | null; text: string }>;
};

export type QaPairView = {
  id: string;
  projectId: string | null;
  projectName: string | null;
  question: string;
  answer: string;
  embedded: boolean;
  updatedAt: string;
};

export type KnowledgeOverview = {
  sources: KnowledgeSourceView[];
  qaPairs: QaPairView[];
  projects: ProjectOption[];
  rules: { usedChars: number; limitChars: number };
  search: { mode: SearchMode; embeddingModel: string | null; needsEmbedding: number };
  storageReady: boolean; // a storage connection is saved and not failing
  aiReady: boolean; // an AI connection is saved
};

export type TryQuestionResponse = {
  result: SearchResult;
  answer: { text: string; ms: number } | null;
  answerError: string | null;
};
