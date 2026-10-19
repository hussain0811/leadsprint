import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { defineConfig } from "prisma/config";

// Load .env files the same way Next.js does, so the CLI and the app share one DATABASE_URL.
loadEnvConfig(process.cwd());

// Resolve the SQLite path against the project root, matching src/lib/db.ts.
const file = (process.env.DATABASE_URL ?? "file:./data/dev.db").replace(/^file:/, "");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: `file:${path.resolve(process.cwd(), file)}`,
  },
});
