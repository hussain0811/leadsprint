// Seeds a demo brokerage so the local build has something to test against.
// Run with `npm run db:seed` (skips if data exists) or `npm run db:reset` (wipes and reseeds).
import { prisma } from "../src/lib/db";

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

async function main() {
  if ((await prisma.org.count()) > 0) {
    console.log("Database already has data; run `npm run db:reset` to start over.");
    return;
  }

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
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
