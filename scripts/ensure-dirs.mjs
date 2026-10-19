// Local data folders are git-ignored, so create them before Prisma or the app needs them.
import fs from "node:fs";

for (const dir of ["data", "storage"]) fs.mkdirSync(dir, { recursive: true });
