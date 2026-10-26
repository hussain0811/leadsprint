import assert from "node:assert/strict";
import { test } from "node:test";
import Papa from "papaparse";
import { CSV_HEADER, leadsCsv } from "./csv";
import { compareByScore, leadFiltersToSearch, parseLeadFilters, phoneMatches, phoneSearchDigits } from "./filters";
import { leadPatchSchema } from "./inputs";
import { answerRows, csvCell, keyAnswers, toCsv } from "./present";
import type { LeadRow } from "./types";

test("filters read from the URL fall back to 'any' for unknown values", () => {
  const f = parseLeadFilters(new URLSearchParams("score=boiling&status=closed&needsPerson=1&q=%20Ahmed%20&sort=score&page=-3"));
  assert.deepEqual(f, { score: null, status: "closed", projectId: null, needsPerson: true, q: "Ahmed", sort: "score", page: 1 });
  assert.equal(parseLeadFilters(new URLSearchParams("page=4&sort=oldest")).page, 4);
  assert.equal(parseLeadFilters(new URLSearchParams("sort=oldest")).sort, "newest");
});

test("filters round-trip through the URL, leaving defaults out", () => {
  const f = parseLeadFilters(new URLSearchParams("score=hot&project=none&q=محمد&page=2"));
  assert.equal(leadFiltersToSearch(parseLeadFilters(new URLSearchParams())), "");
  assert.deepEqual(parseLeadFilters(new URLSearchParams(leadFiltersToSearch(f))), f);
  assert.equal(leadFiltersToSearch(f, { page: false }).includes("page"), false);
});

test("phone search compares digits and ignores a leading 0", () => {
  assert.equal(phoneSearchDigits("050 123"), "50123");
  assert.equal(phoneSearchDigits("+971-50"), "97150");
  assert.equal(phoneSearchDigits("Ahmed 50"), null);
  assert.equal(phoneSearchDigits("12"), null);
  assert.equal(phoneMatches("+971 50 123 4567", "50123"), true);
  assert.equal(phoneMatches("+971 52 999 0000", "50123"), false);
  assert.equal(phoneMatches(null, "50123"), false);
});

test("sorting by score puts hot first, then newest within a score", () => {
  const d = (n: number) => new Date(2026, 0, n);
  const rows = [
    { id: "a", score: "cold", createdAt: d(5) },
    { id: "b", score: "hot", createdAt: d(1) },
    { id: "c", score: "unknown", createdAt: d(9) },
    { id: "d", score: "hot", createdAt: d(3) },
    { id: "e", score: "warm", createdAt: d(2) },
  ];
  assert.deepEqual(rows.sort(compareByScore).map((r) => r.id), ["d", "b", "e", "a", "c"]);
});

test("key answers read as one plain line", () => {
  assert.equal(keyAnswers({ intent: "buy", budgetMin: 1_000_000, budgetMax: 2_000_000, bedrooms: 2, timeline: "1-3m" }), "Buy · AED 1M–2M · 2 bedrooms · In 1 to 3 months");
  assert.equal(keyAnswers({ intent: "rent", budgetMax: 120_000, bedrooms: 0 }), "Rent · Up to AED 120K a year · Studio");
  assert.equal(keyAnswers({ bedrooms: 5, timeline: "now" }), "5+ bedrooms · This month");
  assert.equal(keyAnswers({}), "");
});

test("every answer has a row, and gaps show as unanswered", () => {
  const rows = answerRows({ purpose: "invest", area: "  Dubai Marina " });
  assert.equal(rows.length, 9);
  assert.deepEqual(rows.find((r) => r.label === "Purpose"), { label: "Purpose", value: "As an investment" });
  assert.equal(rows.find((r) => r.label === "Area")?.value, "Dubai Marina");
  assert.equal(rows.find((r) => r.label === "Budget")?.value, null);
});

test("CSV cells are quoted when needed and can't carry formulas", () => {
  assert.equal(csvCell("Ahmed"), "Ahmed");
  assert.equal(csvCell('Say "hi", ok'), '"Say ""hi"", ok"');
  assert.equal(csvCell("line\nbreak"), '"line\nbreak"');
  assert.equal(csvCell("=HYPERLINK(\"x\")"), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell("+971 50 123 4567"), "+971 50 123 4567");
  assert.equal(csvCell("+971 (50) 123-4567"), "+971 (50) 123-4567");
  assert.equal(csvCell("+cmd|' /C calc'!A0"), "'+cmd|' /C calc'!A0");
  assert.equal(csvCell("-2+3+cmd"), "'-2+3+cmd");
  assert.equal(csvCell("@cmd"), "'@cmd");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(-5), "-5");
  assert.equal(toCsv(["a", "b"], [["x", 1]]), "﻿a,b\r\nx,1\r\n");
});

test("the export starts with a BOM and keeps Arabic names intact", () => {
  const row: LeadRow = {
    id: "l1",
    name: "محمد العلي",
    phone: "0501234567",
    projectId: null,
    projectName: "Marina Crest",
    score: "hot",
    status: "handed_off",
    keyAnswers: "",
    needsPerson: true,
    nextBooking: { id: "b1", startsAt: "2026-11-03T06:00:00.000Z", kind: "viewing", status: "booked", projectName: null },
    source: "simulator",
    lastActivityAt: "2026-10-22T08:30:00.000Z",
    createdAt: "2026-10-20T07:00:00.000Z",
  };
  const csv = leadsCsv([{ row, email: null, language: "ar", scoreReasons: ["Wants to buy", "Paying cash"], qualification: { intent: "buy" }, summary: null }]);
  assert.ok(csv.startsWith("﻿Name,Phone,"));
  const parsed = Papa.parse<string[]>(csv.slice(1), { skipEmptyLines: true }).data;
  assert.deepEqual(parsed[0], CSV_HEADER);
  assert.equal(parsed[1].length, CSV_HEADER.length);
  const cells = Object.fromEntries(CSV_HEADER.map((h, i) => [h, parsed[1][i]]));
  assert.equal(cells.Name, "محمد العلي");
  assert.equal(cells.Phone, "0501234567");
  assert.equal(cells["Score reasons"], "Wants to buy; Paying cash");
  assert.equal(cells.Status, "With a person");
  assert.equal(cells["Wants to"], "Buy");
  assert.equal(cells["Needs a person"], "Yes");
  assert.equal(cells.Booking, "Viewing Tue 3 Nov, 10:00 (Dubai), Booked");
  assert.equal(cells.Language, "Arabic");
  assert.equal(cells["Created (UTC)"], "2026-10-20 07:00");
});

test("lead edits clear empty fields and check phone, email and status", () => {
  assert.deepEqual(leadPatchSchema.parse({ name: "  ", phone: "+971 50 123 4567", email: "" }), { name: null, phone: "+971 50 123 4567", email: null });
  assert.equal(leadPatchSchema.safeParse({ phone: "call me" }).success, false);
  assert.equal(leadPatchSchema.safeParse({ phone: "123" }).success, false);
  assert.equal(leadPatchSchema.safeParse({ email: "not-an-email" }).success, false);
  assert.equal(leadPatchSchema.safeParse({ status: "won" }).success, false);
  assert.equal(leadPatchSchema.safeParse({}).success, false);
  assert.deepEqual(leadPatchSchema.parse({ status: "closed" }), { status: "closed" });
});
