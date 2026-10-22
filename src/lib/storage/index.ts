import { findConnection, readStorageConfig } from "../connections";
import { localFolderStorage, type StorageAdapter } from "./local-folder";

export type { StorageAdapter } from "./local-folder";

export const STORAGE_MISSING = "Connect file storage in Connections first.";

// The adapter for the org's saved storage connection. Cloud providers will plug in here.
export async function getStorage(orgId: string): Promise<StorageAdapter> {
  const row = await findConnection(orgId, "storage");
  const config = row?.provider === "local_folder" ? readStorageConfig(row) : null;
  if (!config) throw new Error(STORAGE_MISSING);
  return localFolderStorage(config.path);
}
