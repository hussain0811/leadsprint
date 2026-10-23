// Shapes shared by the projects API and the Projects page. No server imports here, so client components can use it.

export const PROJECT_STATUSES = ["off_plan", "ready"] as const;
export const UNIT_TYPES = ["apartment", "villa", "townhouse", "penthouse"] as const;
export const UNIT_STATUSES = ["available", "reserved", "sold"] as const;
export const SLOT_KINDS = ["viewing", "call"] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type UnitType = (typeof UNIT_TYPES)[number];
export type UnitStatus = (typeof UNIT_STATUSES)[number];
export type SlotKind = (typeof SLOT_KINDS)[number];

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = { off_plan: "Off-plan", ready: "Ready" };
export const UNIT_TYPE_LABEL: Record<UnitType, string> = {
  apartment: "Apartment",
  villa: "Villa",
  townhouse: "Townhouse",
  penthouse: "Penthouse",
};
export const UNIT_STATUS_LABEL: Record<UnitStatus, string> = { available: "Available", reserved: "Reserved", sold: "Sold" };
export const SLOT_KIND_LABEL: Record<SlotKind, string> = { viewing: "Viewing", call: "Call" };

export type ProjectFields = {
  name: string;
  community: string | null;
  city: string | null;
  developer: string | null;
  status: ProjectStatus;
  handover: string | null;
  paymentPlan: string | null;
  permitNumber: string | null;
  description: string | null;
};

export type ProjectView = ProjectFields & { id: string; createdAt: string };

export type ProjectSummary = {
  id: string;
  name: string;
  community: string | null;
  city: string | null;
  status: ProjectStatus;
  handover: string | null;
  units: number;
  availableUnits: number;
  freeSlots: number; // upcoming slots nobody has booked
};

export type UnitFields = {
  unitNo: string;
  type: UnitType;
  bedrooms: number; // 0 = studio
  sizeSqft: number | null;
  price: number;
  status: UnitStatus;
  floor: string | null;
  view: string | null;
};

export type UnitView = UnitFields & { id: string; currency: string };

export type SlotView = {
  id: string;
  startsAt: string;
  durationMin: number;
  kind: SlotKind;
  booking: { status: string; leadName: string | null } | null;
};

// What else goes when a project is deleted, and what stays without it.
export type ProjectRelated = {
  units: number;
  slots: number;
  documents: number;
  qaPairs: number;
  leads: number;
  bookings: number;
};

export type ProjectDetail = {
  project: ProjectView;
  units: UnitView[];
  slots: SlotView[];
  related: ProjectRelated;
};

/* ---------- Import ---------- */

// One row read from an uploaded price list. Fields the file leaves blank (or has no column for) are absent.
export type ImportRow = { unitNo: string } & Partial<Omit<UnitFields, "unitNo">>;

export type ImportField = keyof UnitFields;

export type ImportPreview = {
  fileName: string;
  sheet: string | null;
  columns: { field: ImportField; header: string }[];
  ignoredHeaders: string[];
  add: ImportRow[];
  update: { row: ImportRow; changes: ImportField[] }[];
  unchanged: number;
  errors: { row: number; message: string }[];
  rows: ImportRow[]; // every valid row, sent back to apply the import
};

export type ImportResult = { added: number; updated: number; unchanged: number; errors: { unitNo: string; message: string }[] };

export const IMPORT_FIELD_LABEL: Record<ImportField, string> = {
  unitNo: "Unit",
  type: "Type",
  bedrooms: "Bedrooms",
  sizeSqft: "Size (sq ft)",
  price: "Price (AED)",
  status: "Status",
  floor: "Floor",
  view: "View",
};
