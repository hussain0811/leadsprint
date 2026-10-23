import { prisma } from "@/lib/db";
import type { ProjectDetail, ProjectStatus, ProjectSummary, SlotKind, SlotView, UnitStatus, UnitType, UnitView } from "./types";

// Reads for the Projects page. Every query is scoped to the org.

const UNIT_SELECT = {
  id: true,
  unitNo: true,
  type: true,
  bedrooms: true,
  sizeSqft: true,
  price: true,
  currency: true,
  status: true,
  floor: true,
  view: true,
} as const;

export function unitView(u: {
  id: string;
  unitNo: string;
  type: string;
  bedrooms: number;
  sizeSqft: number | null;
  price: number;
  currency: string;
  status: string;
  floor: string | null;
  view: string | null;
}): UnitView {
  // Picked one by one, so a full database row passed in doesn't leak other columns.
  return {
    id: u.id,
    unitNo: u.unitNo,
    type: u.type as UnitType,
    bedrooms: u.bedrooms,
    sizeSqft: u.sizeSqft,
    price: u.price,
    currency: u.currency,
    status: u.status as UnitStatus,
    floor: u.floor,
    view: u.view,
  };
}

const SLOT_SELECT = {
  id: true,
  startsAt: true,
  durationMin: true,
  kind: true,
  booking: { select: { status: true, lead: { select: { name: true } } } },
} as const;

function slotView(s: {
  id: string;
  startsAt: Date;
  durationMin: number;
  kind: string;
  booking: { status: string; lead: { name: string | null } } | null;
}): SlotView {
  return {
    id: s.id,
    startsAt: s.startsAt.toISOString(),
    durationMin: s.durationMin,
    kind: s.kind as SlotKind,
    booking: s.booking && { status: s.booking.status, leadName: s.booking.lead.name },
  };
}

// Units sort by their number the way people read them: A-2 before A-10.
const byUnitNo = (a: { unitNo: string }, b: { unitNo: string }) =>
  a.unitNo.localeCompare(b.unitNo, "en", { numeric: true, sensitivity: "base" });

export async function findProject(orgId: string, id: string) {
  return prisma.project.findFirst({ where: { id, orgId }, select: { id: true, name: true } });
}

export async function getProjectList(orgId: string, now = new Date()): Promise<ProjectSummary[]> {
  const projects = await prisma.project.findMany({
    where: { orgId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      community: true,
      city: true,
      status: true,
      handover: true,
      _count: {
        select: {
          units: true,
          slots: { where: { startsAt: { gt: now }, booking: { is: null } } },
        },
      },
    },
  });
  const available = await prisma.unit.groupBy({
    by: ["projectId"],
    where: { orgId, status: "available" },
    _count: { _all: true },
  });
  const availableBy = new Map(available.map((a) => [a.projectId, a._count._all]));
  return projects.map((p) => ({
    id: p.id,
    name: p.name,
    community: p.community,
    city: p.city,
    status: p.status as ProjectStatus,
    handover: p.handover,
    units: p._count.units,
    availableUnits: availableBy.get(p.id) ?? 0,
    freeSlots: p._count.slots,
  }));
}

export async function getProjectDetail(orgId: string, id: string, now = new Date()): Promise<ProjectDetail | null> {
  const project = await prisma.project.findFirst({
    where: { id, orgId },
    select: {
      id: true,
      name: true,
      community: true,
      city: true,
      developer: true,
      status: true,
      handover: true,
      paymentPlan: true,
      permitNumber: true,
      description: true,
      createdAt: true,
      units: { select: UNIT_SELECT },
      slots: { where: { startsAt: { gt: now } }, orderBy: { startsAt: "asc" }, select: SLOT_SELECT },
      _count: { select: { units: true, slots: true, sources: true, qaPairs: true, leads: true, bookings: true } },
    },
  });
  if (!project) return null;
  const { units, slots, _count, createdAt, status, ...fields } = project;
  return {
    project: { ...fields, status: status as ProjectStatus, createdAt: createdAt.toISOString() },
    units: units.map(unitView).sort(byUnitNo),
    slots: slots.map(slotView),
    related: {
      units: _count.units,
      slots: _count.slots,
      documents: _count.sources,
      qaPairs: _count.qaPairs,
      leads: _count.leads,
      bookings: _count.bookings,
    },
  };
}

export async function getUnitView(orgId: string, id: string) {
  const unit = await prisma.unit.findFirst({ where: { id, orgId }, select: UNIT_SELECT });
  return unit && unitView(unit);
}

export async function getExistingUnits(orgId: string, projectId: string) {
  const units = await prisma.unit.findMany({ where: { orgId, projectId }, select: UNIT_SELECT });
  return units.map(unitView);
}
