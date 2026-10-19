import { prisma } from "./db";

// The local build runs as a single brokerage with no sign-in; multi-org accounts come later.
export async function getOrg() {
  const org = await prisma.org.findFirst({ orderBy: { createdAt: "asc" } });
  return org ?? prisma.org.create({ data: { name: "My brokerage" } });
}
