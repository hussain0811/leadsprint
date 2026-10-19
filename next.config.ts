import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Load the SQLite adapter with Node's own require so it finds the native better-sqlite3 build.
  serverExternalPackages: ["@prisma/adapter-better-sqlite3"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
