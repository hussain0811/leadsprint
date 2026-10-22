import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { crossSiteError, jsonError } from "@/lib/http";
import { ingestSource } from "@/lib/knowledge/ingest";
import {
  acceptedExtension,
  baseFileName,
  mimeTypeFor,
  projectIdSchema,
  roleSchema,
  safeFileName,
  titleFromFileName,
  UNKNOWN_PROJECT,
  validUntilSchema,
} from "@/lib/knowledge/inputs";
import { findProject, getSourceView } from "@/lib/knowledge/queries";
import { MAX_UPLOAD_BYTES } from "@/lib/knowledge/types";
import { getOrg } from "@/lib/org";
import { getStorage, type StorageAdapter } from "@/lib/storage";

const TOO_LARGE = `Files can be up to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`;
// Room for the form fields and boundaries around the file itself.
const FORM_OVERHEAD_BYTES = 64 * 1024;

const fieldsSchema = z.object({
  role: roleSchema,
  projectId: projectIdSchema,
  title: z.string().trim().max(200, "Keep the title under 200 characters."),
  validUntil: validUntilSchema,
});

// Missing form fields count as empty, which means "not set" for every optional field.
const field = (value: FormDataEntryValue | null) => value ?? "";

export async function POST(req: Request) {
  const blocked = crossSiteError(req);
  if (blocked) return blocked;

  // The size must be known up front, so an oversized upload is refused before it is read into memory.
  const length = req.headers.get("content-length");
  if (length === null) return jsonError("Send the upload with its size (a Content-Length header).", 411);
  if (Number(length) > MAX_UPLOAD_BYTES + FORM_OVERHEAD_BYTES) return jsonError(TOO_LARGE, 413);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError("Send the file as a form upload.");
  }

  const file = form.get("file");
  if (!file || typeof file === "string") return jsonError("Choose a file to upload.");
  const fileName = baseFileName(file.name);
  const ext = acceptedExtension(fileName);
  if (!ext) return jsonError("Upload a PDF, Word (.docx), Excel (.xlsx), CSV, text (.txt) or Markdown (.md) file.");
  if (file.size > MAX_UPLOAD_BYTES) return jsonError(TOO_LARGE, 413);
  if (file.size === 0) return jsonError("This file is empty.");

  const fields = fieldsSchema.safeParse({
    role: form.get("role"),
    projectId: field(form.get("projectId")),
    title: field(form.get("title")),
    validUntil: field(form.get("validUntil")),
  });
  if (!fields.success) return jsonError(fields.error.issues[0]?.message ?? "The upload isn't valid.");
  const { role, projectId, title, validUntil } = fields.data;

  const org = await getOrg();
  if (projectId && !(await findProject(org.id, projectId))) return jsonError(UNKNOWN_PROJECT);

  // The file's fingerprint sits in its storage key, so the same file can't be added twice to one project.
  const data = Buffer.from(await file.arrayBuffer());
  const hash = crypto.createHash("sha256").update(data).digest("hex");
  const existing = await prisma.knowledgeSource.findFirst({
    where: { orgId: org.id, projectId, storageKey: { contains: `/${hash}/` } },
    select: { title: true },
  });
  if (existing) {
    const scope = projectId ? "this project" : "all projects";
    return jsonError(`This file is already uploaded for ${scope} as "${existing.title}".`, 409);
  }

  let storage: StorageAdapter;
  try {
    storage = await getStorage(org.id);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "File storage isn't available.");
  }

  const source = await prisma.knowledgeSource.create({
    data: {
      orgId: org.id,
      projectId,
      kind: "file",
      role,
      title: title || titleFromFileName(fileName),
      fileName,
      mimeType: mimeTypeFor(ext),
      sizeBytes: file.size,
      validUntil,
    },
  });

  // Save the file and record where it went together; if either fails, undo both, so neither an
  // orphan file nor a source without its file is left behind.
  const storageKey = `${org.id}/knowledge/${source.id}/${hash}/${safeFileName(fileName)}`;
  try {
    await storage.put(storageKey, data);
    await prisma.knowledgeSource.update({ where: { id: source.id }, data: { storageKey } });
  } catch (err) {
    await storage.remove(storageKey).catch(() => {});
    await prisma.knowledgeSource.deleteMany({ where: { id: source.id } }).catch(() => {});
    return jsonError(`Couldn't save the file to storage: ${err instanceof Error ? err.message : "unknown error"}`, 500);
  }

  await ingestSource(source.id);
  return Response.json({ source: await getSourceView(org.id, source.id) }, { status: 201 });
}
