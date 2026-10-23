import { z } from "zod";
import { isCalendarDate, isClockTime } from "./dubai-time";
import { PROJECT_STATUSES, SLOT_KINDS, UNIT_STATUSES, UNIT_TYPES } from "./types";

// Request fields for the projects API. No database access here, so it stays easy to test.

export const PROJECT_NOT_FOUND = "This project doesn't exist. It may have been deleted.";
export const UNIT_NOT_FOUND = "This unit doesn't exist. It may have been deleted.";
export const SLOT_NOT_FOUND = "This time slot doesn't exist. It may have been deleted.";

// Blank optional text is stored as null ("not set").
const optionalText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep the ${label} under ${max.toLocaleString("en-US")} characters.`)
    .nullable()
    .transform((v) => v || null);

/* ---------- Projects ---------- */

// Fields without defaults, so a PATCH that leaves a field out keeps it as it is.
const projectFields = z.object({
  name: z.string().trim().min(1, "Enter the project name.").max(120, "Keep the project name under 120 characters."),
  community: optionalText("community", 120),
  city: optionalText("city", 80),
  developer: optionalText("developer", 120),
  status: z.enum(PROJECT_STATUSES, { error: "Choose off-plan or ready." }),
  handover: optionalText("handover", 120),
  paymentPlan: optionalText("payment plan", 1000),
  permitNumber: optionalText("permit number", 80),
  description: optionalText("description", 4000),
});

export const projectSchema = projectFields.extend({
  community: projectFields.shape.community.default(null),
  city: projectFields.shape.city.default(null),
  developer: projectFields.shape.developer.default(null),
  status: projectFields.shape.status.default("off_plan"),
  handover: projectFields.shape.handover.default(null),
  paymentPlan: projectFields.shape.paymentPlan.default(null),
  permitNumber: projectFields.shape.permitNumber.default(null),
  description: projectFields.shape.description.default(null),
});

export const projectPatchSchema = projectFields.partial();

/* ---------- Units ---------- */

// Limits are generous; they only catch typing mistakes like a few extra zeros.
export const MAX_BEDROOMS = 20;
export const MAX_PRICE = 10_000_000_000;
export const MAX_SIZE_SQFT = 1_000_000;

export const unitNoSchema = z
  .string()
  .trim()
  .min(1, "Enter the unit number.")
  .max(40, "Keep the unit number under 40 characters.");

const unitFields = z.object({
  unitNo: unitNoSchema,
  type: z.enum(UNIT_TYPES, { error: "Choose apartment, villa, townhouse or penthouse." }),
  bedrooms: z
    .number({ error: "Enter the number of bedrooms (0 for a studio)." })
    .int("Bedrooms must be a whole number.")
    .min(0, "Bedrooms can't be negative.")
    .max(MAX_BEDROOMS, `Bedrooms can be at most ${MAX_BEDROOMS}.`),
  sizeSqft: z
    .number({ error: "Enter the size as a number of square feet." })
    .positive("The size must be more than 0.")
    .max(MAX_SIZE_SQFT, "That size looks too large. Enter it in square feet.")
    .nullable(),
  price: z
    .number({ error: "Enter the price in AED." })
    .positive("The price must be more than 0.")
    .max(MAX_PRICE, "That price looks too large. Enter it in AED."),
  status: z.enum(UNIT_STATUSES, { error: "Choose available, reserved or sold." }),
  floor: optionalText("floor", 20),
  view: optionalText("view", 100),
});

export const unitSchema = unitFields.extend({
  sizeSqft: unitFields.shape.sizeSqft.default(null),
  status: unitFields.shape.status.default("available"),
  floor: unitFields.shape.floor.default(null),
  view: unitFields.shape.view.default(null),
});

// Fields left out stay as they are.
export const unitPatchSchema = unitFields.partial();

// A row from an import: only the unit number is required; the rest are applied when present.
export const importRowSchema = unitFields.partial().extend({ unitNo: unitNoSchema });
export const MAX_IMPORT_ROWS = 5000;
export const importApplySchema = z.object({
  rows: z
    .array(importRowSchema)
    .min(1, "There are no units to import.")
    .max(MAX_IMPORT_ROWS, `Import up to ${MAX_IMPORT_ROWS.toLocaleString("en-US")} units at a time.`),
});

/* ---------- Viewing slots ---------- */

export const MAX_SLOT_TIMES = 12;
export const MAX_REPEAT_DAYS = 60;
export const MAX_SLOTS_PER_REQUEST = 300;

export const slotsSchema = z.object({
  date: z.string().trim().refine(isCalendarDate, "Enter the date as YYYY-MM-DD."),
  times: z
    .array(z.string().trim().refine(isClockTime, "Enter each time as HH:MM, for example 10:30."))
    .min(1, "Add at least one time.")
    .max(MAX_SLOT_TIMES, `Add up to ${MAX_SLOT_TIMES} times a day.`),
  durationMin: z
    .number({ error: "Choose how long each slot lasts." })
    .int("Enter the length in whole minutes.")
    .min(10, "Slots must last at least 10 minutes.")
    .max(480, "Slots can last at most 8 hours."),
  kind: z.enum(SLOT_KINDS, { error: "Choose viewing or call." }).default("viewing"),
  repeatDays: z
    .number({ error: "Enter how many more days to add." })
    .int("Enter a whole number of days.")
    .min(0, "Days can't be negative.")
    .max(MAX_REPEAT_DAYS, `Repeat for at most ${MAX_REPEAT_DAYS} days.`)
    .default(0),
});
