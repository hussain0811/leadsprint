// Seeds a demo brokerage so the local build has something to test against.
// Run with `npm run db:seed` (adds only what is missing) or `npm run db:reset` (wipes and reseeds).
import { loadEnvConfig } from "@next/env";
import type { PrismaClient } from "../src/generated/prisma/client";

// Load .env before anything reads it: the database path, and the key that opens saved connection secrets.
loadEnvConfig(process.cwd());

const DUBAI_UTC_OFFSET_HOURS = 4;

// Viewing slots at 11:00 and 16:00 Dubai time for the next 10 days.
function upcomingSlots(days: number) {
  const slots: Date[] = [];
  const now = new Date();
  for (let d = 1; d <= days; d++) {
    for (const hour of [11, 16]) {
      const at = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + d, hour - DUBAI_UTC_OFFSET_HOURS),
      );
      slots.push(at);
    }
  }
  return slots;
}

async function createBrokerage(prisma: PrismaClient) {
  const org = await prisma.org.create({
    data: { name: "Demo Realty", website: "demo-realty.example", defaultLang: "en" },
  });

  const marina = await prisma.project.create({
    data: {
      orgId: org.id,
      name: "Marina Crest",
      community: "Dubai Marina",
      city: "Dubai",
      developer: "Crest Developments",
      status: "off_plan",
      handover: "Q4 2027",
      paymentPlan: "10% on booking, 50% during construction, 40% on handover",
      permitNumber: "DEMO-PERMIT-0001",
      description: "Off-plan tower in Dubai Marina with studios to 4-bedroom penthouses, marina and sea views.",
    },
  });

  const creek = await prisma.project.create({
    data: {
      orgId: org.id,
      name: "Creekside Residences",
      community: "Dubai Creek Harbour",
      city: "Dubai",
      developer: "Harbour Homes",
      status: "ready",
      handover: "Ready to move in",
      paymentPlan: "Cash or mortgage; 10% deposit on signing",
      permitNumber: "DEMO-PERMIT-0002",
      description: "Completed residences by the creek with park and skyline views.",
    },
  });

  await prisma.unit.createMany({
    data: [
      { unitNo: "S-0101", type: "apartment", bedrooms: 0, sizeSqft: 480, price: 950000, floor: "1", view: "City" },
      { unitNo: "A-0703", type: "apartment", bedrooms: 1, sizeSqft: 820, price: 1450000, floor: "7", view: "Marina" },
      { unitNo: "A-1205", type: "apartment", bedrooms: 1, sizeSqft: 845, price: 1520000, floor: "12", view: "Marina", status: "reserved" },
      { unitNo: "B-1502", type: "apartment", bedrooms: 2, sizeSqft: 1250, price: 2350000, floor: "15", view: "Sea" },
      { unitNo: "B-2101", type: "apartment", bedrooms: 2, sizeSqft: 1300, price: 2480000, floor: "21", view: "Sea" },
      { unitNo: "C-2804", type: "apartment", bedrooms: 3, sizeSqft: 1850, price: 3900000, floor: "28", view: "Sea" },
      { unitNo: "PH-4001", type: "penthouse", bedrooms: 4, sizeSqft: 3600, price: 9800000, floor: "40", view: "Sea and marina", status: "sold" },
    ].map((u) => ({ ...u, orgId: org.id, projectId: marina.id })),
  });

  await prisma.unit.createMany({
    data: [
      { unitNo: "CR-305", type: "apartment", bedrooms: 1, sizeSqft: 760, price: 1250000, floor: "3", view: "Park" },
      { unitNo: "CR-912", type: "apartment", bedrooms: 2, sizeSqft: 1180, price: 2050000, floor: "9", view: "Creek" },
      { unitNo: "CR-TH2", type: "townhouse", bedrooms: 3, sizeSqft: 2400, price: 3600000, view: "Park" },
    ].map((u) => ({ ...u, orgId: org.id, projectId: creek.id })),
  });

  await prisma.availabilitySlot.createMany({
    data: upcomingSlots(10).map((startsAt) => ({ orgId: org.id, projectId: marina.id, startsAt })),
  });

  const counts = {
    projects: await prisma.project.count(),
    units: await prisma.unit.count(),
    slots: await prisma.availabilitySlot.count(),
  };
  console.log(`Seeded "${org.name}":`, counts);
  return org;
}

/* ---------- Demo knowledge (must agree with the projects and units above) ---------- */

type DemoSource = { title: string; project: string | null; role: "reference" | "rules"; text: string };
type DemoQa = { project: string | null; question: string; answer: string };

const DEMO_SOURCES: DemoSource[] = [
  {
    title: "Marina Crest fact sheet",
    project: "Marina Crest",
    role: "reference",
    text: `# Marina Crest fact sheet

Marina Crest is an off-plan residential tower in Dubai Marina, Dubai, by Crest Developments. Handover is planned for Q4 2027. Advertising permit: DEMO-PERMIT-0001.

## Homes

Marina Crest has studios, one-, two- and three-bedroom apartments and four-bedroom penthouses, from the 1st floor up to the 40th. Lower floors look over the city, middle floors over the marina, and upper floors over the sea.

- Studio: about 480 sq ft, city view, from AED 950,000.
- One bedroom: 820 to 845 sq ft, marina view, from AED 1,450,000.
- Two bedrooms: 1,250 to 1,300 sq ft, sea view, from AED 2,350,000.
- Three bedrooms: about 1,850 sq ft, sea view, from AED 3,900,000.
- Four-bedroom penthouse: about 3,600 sq ft on the 40th floor, with sea and marina views. The penthouse is sold.

Prices are subject to availability.

## Building

Residents share a swimming pool, a gym and covered parking. The tower is a short walk from the marina promenade.

## Payment

10% on booking, 50% during construction and 40% on handover. See the Marina Crest payment plan for details.`,
  },
  {
    title: "Marina Crest payment plan",
    project: "Marina Crest",
    role: "reference",
    text: `# Marina Crest payment plan

Marina Crest is sold off-plan with a 10/50/40 payment plan:

- 10% on booking, to reserve the home.
- 50% during construction, in instalments linked to construction progress.
- 40% on handover, planned for Q4 2027.

## Example

For a one-bedroom apartment at AED 1,450,000:

- On booking: AED 145,000
- During construction: AED 725,000 in total
- On handover: AED 580,000

## Good to know

- Dubai Land Department registration fees are paid on booking, on top of the price. The team confirms the exact amount.
- Payments go into the project's escrow account.
- Prices and payment plans are subject to availability.`,
  },
  {
    title: "Creekside Residences fact sheet",
    project: "Creekside Residences",
    role: "reference",
    text: `# Creekside Residences fact sheet

Creekside Residences is a completed community in Dubai Creek Harbour, Dubai, by Harbour Homes. The homes are ready to move in. Advertising permit: DEMO-PERMIT-0002.

## Homes

- One bedroom: about 760 sq ft on the 3rd floor, park view, AED 1,250,000.
- Two bedrooms: about 1,180 sq ft on the 9th floor, creek view, AED 2,050,000.
- Three-bedroom townhouse: about 2,400 sq ft, park view, AED 3,600,000.

Prices are subject to availability.

## Buying

Buyers can pay cash or use a mortgage. A 10% deposit is paid on signing. Because the homes are complete, buyers can move in as soon as the sale is registered.

## Views

The residences look out over the creek, the park and the Dubai skyline.`,
  },
  {
    title: "Viewings and bookings",
    project: null,
    role: "reference",
    text: `# Viewings and bookings

## Marina Crest

Viewings for Marina Crest run every day at 11:00 and 16:00 Dubai time and take about 45 minutes. Choose a time and the team confirms it.

## Creekside Residences

Creekside Residences is complete, so you view the homes themselves. The team arranges a time that suits you.

## Calls

If you can't come in person, the team can arrange a call instead of a viewing.

## Before you come

Bring your Emirates ID or passport. To change or cancel a viewing, reply to your confirmation message.`,
  },
  {
    title: "How we talk to buyers",
    project: null,
    role: "rules",
    text: `# How we talk to buyers

- Be polite and brief.
- Reply in the buyer's language. If they write in Arabic, reply in Arabic.
- Prices are subject to availability. Say so whenever you mention a price.
- Never promise returns, rental yields, capital growth or resale prices.
- Visa and mortgage questions go to the team. Offer to put the buyer in touch with a team member instead of answering them yourself.`,
  },
];

const DEMO_QA: DemoQa[] = [
  {
    project: "Marina Crest",
    question: "When is handover at Marina Crest?",
    answer: "Handover is planned for Q4 2027.",
  },
  {
    project: "Marina Crest",
    question: "What is the payment plan for Marina Crest?",
    answer: "10% on booking, 50% during construction and 40% on handover, which is planned for Q4 2027.",
  },
  {
    project: "Creekside Residences",
    question: "Can I move in straight away at Creekside Residences?",
    answer:
      "Yes. Creekside Residences is complete and ready to move in. You can pay cash or use a mortgage, with a 10% deposit on signing.",
  },
  {
    project: null,
    question: "How do I book a viewing?",
    answer:
      "Marina Crest viewings run every day at 11:00 and 16:00 Dubai time and take about 45 minutes. Tell us which time suits you and we'll confirm it. For Creekside Residences, the team arranges a time with you.",
  },
  {
    project: null,
    question: "Can you help me with a mortgage or a residence visa?",
    answer: "Our team handles mortgage and visa questions personally. Share your name and number and a team member will contact you.",
  },
  {
    project: "Marina Crest",
    question: "ما هي خطة الدفع في مارينا كريست؟",
    answer: "خطة الدفع في مارينا كريست هي 10% عند الحجز، و50% خلال فترة البناء، و40% عند التسليم المتوقع في الربع الأخير من عام 2027.",
  },
];

type Ingest = (sourceId: string) => Promise<void>;

// Adds whatever demo knowledge is missing, matched by title or question, so running twice adds nothing.
async function addKnowledge(prisma: PrismaClient, ingestSource: Ingest, orgId: string) {
  const projects = await prisma.project.findMany({ where: { orgId }, select: { id: true, name: true } });
  const projectIds = new Map(projects.map((p) => [p.name, p.id]));
  const projectIdFor = (name: string | null) => (name === null ? null : projectIds.get(name));

  for (const demo of DEMO_SOURCES) {
    const projectId = projectIdFor(demo.project);
    if (projectId === undefined) {
      console.log(`  Skipped "${demo.title}": there is no project called ${demo.project}.`);
      continue;
    }
    const existing = await prisma.knowledgeSource.findFirst({
      where: { orgId, title: demo.title },
      select: { id: true, status: true },
    });
    if (existing?.status === "ready") continue;

    // A demo source that failed before (for example, seeded before the AI server was running) is read again.
    const id =
      existing?.id ??
      (
        await prisma.knowledgeSource.create({
          data: { orgId, projectId, kind: "text", role: demo.role, title: demo.title, text: demo.text },
        })
      ).id;
    await ingestSource(id);

    const source = await prisma.knowledgeSource.findUniqueOrThrow({
      where: { id },
      select: { status: true, error: true, _count: { select: { chunks: true } } },
    });
    const detail =
      source.status === "ready"
        ? demo.role === "rules"
          ? "ready (rules)"
          : `ready, ${source._count.chunks} passages`
        : `${source.status}: ${source.error}`;
    console.log(`  ${demo.title}: ${detail}`);
  }

  let added = 0;
  for (const demo of DEMO_QA) {
    const projectId = projectIdFor(demo.project);
    if (projectId === undefined) continue;
    const exists = await prisma.qaPair.count({ where: { orgId, question: demo.question } });
    if (exists) continue;
    await prisma.qaPair.create({ data: { orgId, projectId, question: demo.question, answer: demo.answer } });
    added++;
  }
  console.log(`  Q&A pairs added: ${added}`);
}

// Saves the ready-made flow so the Flows page has something to edit; an org that saved its own keeps it.
async function addDefaultFlow(prisma: PrismaClient, orgId: string) {
  const { DEFAULT_FLOW, validateFlow } = await import("../src/lib/chat/flow");
  const { FLOW_NAME } = await import("../src/lib/chat/turn");
  if (await prisma.flow.count({ where: { orgId } })) {
    console.log("  Flow: already saved.");
    return;
  }
  const problems = validateFlow(DEFAULT_FLOW);
  if (problems.length) {
    console.log(`  Flow skipped: the ready-made flow has problems: ${problems.join("; ")}`);
    return;
  }
  await prisma.flow.create({ data: { orgId, name: FLOW_NAME, definition: JSON.stringify(DEFAULT_FLOW), isDefault: true } });
  console.log("  Flow: saved the ready-made English/Arabic flow.");
}

async function main() {
  // Imported only now that .env is loaded, because the database client reads DATABASE_URL as it loads.
  const { prisma } = await import("../src/lib/db");
  const { embedPendingChunks, ingestSource } = await import("../src/lib/knowledge/ingest");

  try {
    let org = await prisma.org.findFirst({ orderBy: { createdAt: "asc" } });
    if (org) {
      console.log(`"${org.name}" is already in the database; adding any missing demo knowledge. Run \`npm run db:reset\` to start over.`);
    } else {
      org = await createBrokerage(prisma);
    }

    console.log("Chat:");
    try {
      await addDefaultFlow(prisma, org.id);
    } catch (err) {
      // The chat falls back to the ready-made flow anyway, so a failure here only skips the saved copy.
      console.log(`  Flow skipped: ${err instanceof Error ? err.message : err}`);
    }

    console.log("Demo knowledge:");
    await addKnowledge(prisma, ingestSource, org.id);

    try {
      const { embedded, skipped } = await embedPendingChunks(org.id);
      console.log(skipped ? `  Embeddings: ${skipped}` : `  Embeddings: added ${embedded}.`);
    } catch (err) {
      // Keyword search works without embeddings, and POST /api/knowledge/embed catches up later.
      console.log(`  Embeddings skipped: ${err instanceof Error ? err.message : err}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
