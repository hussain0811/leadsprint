import { z } from "zod";
import { ACCEPTED_EXTENSIONS } from "./types";

// Request fields shared by the knowledge API routes. No database access here, so it stays easy to test.

export const UNKNOWN_PROJECT = "Choose a project from the list.";
export const MAX_TEXT_CHARS = 200_000;

export const roleSchema = z.enum(["reference", "rules"], { error: "Choose whether this is a reference or a rules document." });

// "" or null means all projects.
export const projectIdSchema = z
  .string()
  .trim()
  .max(100)
  .nullable()
  .transform((v) => v || null);

export const titleSchema = z.string().trim().min(1, "Enter a title.").max(200, "Keep the title under 200 characters.");

export const prioritySchema = z.number().int("Priority must be a whole number.").min(-1000).max(1000);

// A "valid until" date counts through the end of that day, so it is stored as 23:59:59.999 UTC.
export const validUntilSchema = z
  .string()
  .trim()
  .nullable()
  .refine((v) => !v || isCalendarDate(v), "Enter the date as YYYY-MM-DD.")
  .transform((v) => (v ? new Date(`${v}T23:59:59.999Z`) : null));

export const questionSchema = z
  .string()
  .trim()
  .min(1, "Enter the question.")
  .max(500, "Keep the question under 500 characters.");

export const answerSchema = z
  .string()
  .trim()
  .min(1, "Enter the answer.")
  .max(4000, "Keep the answer under 4,000 characters.");

function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/* ---------- Pages ---------- */

// People often paste "example.com/page"; assume https when no scheme is given.
export function normalizePageAddress(raw: string) {
  const value = raw.trim();
  return /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`;
}

/* ---------- Files ---------- */

export type AcceptedExtension = (typeof ACCEPTED_EXTENSIONS)[number];

// Decided by the extension: browsers report CSV and Markdown types inconsistently.
const MIME_TYPES: Record<AcceptedExtension, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".csv": "text/csv",
  ".txt": "text/plain",
  ".md": "text/markdown",
};

// The name without any folder part some browsers include.
export function baseFileName(name: string) {
  return (name.split(/[\\/]/).pop() ?? "").trim().slice(0, 255);
}

function splitExtension(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? { stem: name.slice(0, dot), ext: name.slice(dot).toLowerCase() } : { stem: name, ext: "" };
}

export function acceptedExtension(name: string): AcceptedExtension | null {
  const { ext } = splitExtension(baseFileName(name));
  return (ACCEPTED_EXTENSIONS as readonly string[]).includes(ext) ? (ext as AcceptedExtension) : null;
}

export function mimeTypeFor(ext: AcceptedExtension) {
  return MIME_TYPES[ext];
}

// The file name without its extension, used as the title when none is given.
export function titleFromFileName(name: string) {
  const base = baseFileName(name);
  return (splitExtension(base).stem.trim() || base).slice(0, 200);
}

// A file name that is safe as a storage key on any disk or bucket: letters in any script, digits,
// dots, dashes and underscores. Windows device names get a prefix because they can't be file names there.
export function safeFileName(name: string) {
  const { stem, ext } = splitExtension(baseFileName(name).normalize("NFC"));
  let safeStem = stem
    .replace(/[^\p{L}\p{M}\p{N}._-]+/gu, "_")
    .replace(/^[._]+|[._]+$/g, "")
    .slice(0, 100);
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(safeStem)) safeStem = `_${safeStem}`;
  return `${safeStem || "file"}${ext.replace(/[^a-z\d.]/g, "")}`;
}
