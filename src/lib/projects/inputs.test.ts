import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays, dubaiClock, dubaiDate, dubaiToUtc, isCalendarDate, isClockTime, slotStarts } from "./dubai-time";
import { importRowSchema, projectPatchSchema, projectSchema, slotsSchema, unitPatchSchema, unitSchema } from "./inputs";

test("a new project fills defaults and stores blank fields as not set", () => {
  const project = projectSchema.parse({ name: "  Marina Crest ", community: "", city: "Dubai" });
  assert.equal(project.name, "Marina Crest");
  assert.equal(project.community, null);
  assert.equal(project.status, "off_plan");
  assert.equal(project.description, null);
  assert.equal(projectSchema.safeParse({ name: " " }).success, false);
});

test("a project or unit patch only carries the fields sent", () => {
  assert.deepEqual(projectPatchSchema.parse({ handover: "Q1 2028" }), { handover: "Q1 2028" });
  assert.deepEqual(unitPatchSchema.parse({ price: 2000000 }), { price: 2000000 });
  assert.equal(projectPatchSchema.safeParse({ status: "sold_out" }).success, false);
});

test("units need a type, bedrooms and a positive price", () => {
  const unit = unitSchema.parse({ unitNo: "S-1", type: "apartment", bedrooms: 0, price: 950000 });
  assert.equal(unit.status, "available");
  assert.equal(unit.sizeSqft, null);
  assert.equal(unitSchema.safeParse({ unitNo: "S-1", type: "castle", bedrooms: 0, price: 1 }).success, false);
  assert.equal(unitSchema.safeParse({ unitNo: "S-1", type: "villa", bedrooms: 1.5, price: 1 }).success, false);
  assert.equal(unitSchema.safeParse({ unitNo: "S-1", type: "villa", bedrooms: 1, price: 0 }).success, false);
  assert.deepEqual(importRowSchema.parse({ unitNo: "A-1" }), { unitNo: "A-1" });
});

test("slot requests check dates, times and how many days", () => {
  const ok = slotsSchema.parse({ date: "2026-11-03", times: ["10:00"], durationMin: 45 });
  assert.equal(ok.kind, "viewing");
  assert.equal(ok.repeatDays, 0);
  assert.equal(slotsSchema.safeParse({ date: "2026-02-30", times: ["10:00"], durationMin: 45 }).success, false);
  assert.equal(slotsSchema.safeParse({ date: "2026-11-03", times: ["25:00"], durationMin: 45 }).success, false);
  assert.equal(slotsSchema.safeParse({ date: "2026-11-03", times: [], durationMin: 45 }).success, false);
  assert.equal(slotsSchema.safeParse({ date: "2026-11-03", times: ["10:00"], durationMin: 45, repeatDays: 61 }).success, false);
});

test("Dubai times are UTC+4 all year", () => {
  assert.equal(dubaiToUtc("2026-11-03", "10:00").toISOString(), "2026-11-03T06:00:00.000Z");
  assert.equal(dubaiToUtc("2026-07-01", "02:30").toISOString(), "2026-06-30T22:30:00.000Z");
  const late = new Date("2026-11-03T21:15:00Z");
  assert.equal(dubaiDate(late), "2026-11-04");
  assert.equal(dubaiClock(late), "01:15");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.ok(isCalendarDate("2028-02-29"));
  assert.ok(!isCalendarDate("2026-13-01"));
  assert.ok(isClockTime("23:59"));
  assert.ok(!isClockTime("9:00"));
});

test("repeating times over several days makes one slot per time per day", () => {
  const starts = slotStarts("2026-11-03", ["14:00", "10:00", "10:00"], 2).map((d) => d.toISOString());
  assert.deepEqual(starts, [
    "2026-11-03T06:00:00.000Z",
    "2026-11-03T10:00:00.000Z",
    "2026-11-04T06:00:00.000Z",
    "2026-11-04T10:00:00.000Z",
    "2026-11-05T06:00:00.000Z",
    "2026-11-05T10:00:00.000Z",
  ]);
});
