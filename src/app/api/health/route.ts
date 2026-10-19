import { connection } from "next/server";
import { prisma } from "@/lib/db";

// Quick check that the app can reach the local database.
export async function GET() {
  await connection();
  const [orgs, projects, units, slots] = await Promise.all([
    prisma.org.count(),
    prisma.project.count(),
    prisma.unit.count(),
    prisma.availabilitySlot.count(),
  ]);
  return Response.json({ ok: true, orgs, projects, units, slots });
}
