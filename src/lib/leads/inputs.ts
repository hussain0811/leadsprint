import { z } from "zod";
import { LEAD_STATUSES } from "./types";

// Request bodies for the lead routes. Empty text clears a field (stored as null).

const emptyToNull = (v: string) => (v === "" ? null : v);

export const nameSchema = z.string().trim().max(100, "Keep the name under 100 characters.").transform(emptyToNull);

export const phoneSchema = z
  .string()
  .trim()
  .max(30, "Keep the phone number under 30 characters.")
  .regex(/^[+\d\s()-]*$/, "Enter the phone number with digits only, like +971 50 123 4567.")
  .refine((v) => v === "" || v.replace(/\D/g, "").length >= 6, "The phone number needs at least 6 digits.")
  .transform(emptyToNull);

export const emailSchema = z
  .string()
  .trim()
  .max(200, "Keep the email under 200 characters.")
  .refine((v) => v === "" || z.email().safeParse(v).success, "Enter an email address like name@example.com.")
  .transform(emptyToNull);

export const statusSchema = z.enum(LEAD_STATUSES, { error: "Choose a status from the list." });

// PATCH /api/leads/[id]: fields left out stay as they are.
export const leadPatchSchema = z
  .object({
    name: nameSchema.optional(),
    phone: phoneSchema.optional(),
    email: emailSchema.optional(),
    status: statusSchema.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Send at least one field to change.");

export type LeadPatch = z.infer<typeof leadPatchSchema>;

// PATCH /api/leads/[id]/bookings/[bookingId]
export const bookingPatchSchema = z.object({
  status: z.enum(["cancelled", "done"], { error: "A booking can be cancelled or marked done." }),
});
