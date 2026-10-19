import fs from "node:fs/promises";
import path from "node:path";

// Development-only storage: files live in a folder on this computer.
// Cloud buckets (R2, S3, B2) will implement the same interface later.
export type StorageAdapter = {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
};

export function resolveFolder(folder: string) {
  return path.resolve(process.cwd(), folder);
}

export function localFolderStorage(folder: string): StorageAdapter {
  const root = resolveFolder(folder);
  const fileFor = (key: string) => {
    const file = path.resolve(root, key);
    if (!file.startsWith(root + path.sep)) throw new Error("A storage key tried to leave the storage folder.");
    return file;
  };
  return {
    async put(key, data) {
      const file = fileFor(key);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, data);
    },
    get: (key) => fs.readFile(fileFor(key)),
    async remove(key) {
      await fs.rm(fileFor(key), { force: true });
    },
  };
}

export type StorageCheck = { status: "ok" | "error"; detail: string; checkedAt: string };

// Writes, reads back and deletes a small file, so problems show up before the first real upload.
export async function testStorage(storage: StorageAdapter): Promise<StorageCheck> {
  const key = `.leadsprint-check/${Date.now()}.txt`;
  const content = Buffer.from("LeadSprint storage check");
  const start = Date.now();
  try {
    await storage.put(key, content);
    const back = await storage.get(key);
    await storage.remove(key);
    if (!back.equals(content)) throw new Error("The file read back didn't match what was saved.");
    return {
      status: "ok",
      detail: `Saved, read back and deleted a test file in ${Date.now() - start} ms.`,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      status: "error",
      detail: err instanceof Error ? err.message : "The storage check failed.",
      checkedAt: new Date().toISOString(),
    };
  }
}
