import fs from "node:fs";
import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";

// Resolve the SQLite path against the project root, matching prisma.config.ts.
function sqliteUrl() {
  const file = path.resolve(
    process.cwd(),
    (process.env.DATABASE_URL ?? "file:./data/dev.db").replace(/^file:/, ""),
  );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return `file:${file}`;
}

function createClient() {
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: sqliteUrl() }) });
}

// Reuse one client across hot reloads in development.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
