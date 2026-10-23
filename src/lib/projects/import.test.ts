import assert from "node:assert/strict";
import { test } from "node:test";
import { Workbook } from "exceljs";
import {
  buildPreview,
  matchColumns,
  NO_HEADER,
  parseAmount,
  parseBedrooms,
  parseSheet,
  parseStatus,
  parseType,
  planImport,
  TEMPLATE_CSV,
  type ExistingUnit,
} from "./import";
import { readSheets, SheetError, type Sheet } from "./sheet";

const sheet = (rows: string[][]): Sheet => ({ name: null, rows: rows.map((cells, i) => ({ row: i + 1, cells })) });

const existing: ExistingUnit[] = [
  { id: "u1", unitNo: "A-0701", type: "apartment", bedrooms: 1, sizeSqft: 820, price: 1450000, status: "available", floor: "7", view: "Marina" },
];

test("matches headers by name, whatever their case and punctuation", () => {
  const { columns, ignored } = matchColumns(["Unit No.", "Type", "Beds", "Size (sq ft)", "Price (AED)", "STATUS", "Floor", "View", "Notes"]);
  assert.deepEqual(
    columns.map((c) => c.field),
    ["unitNo", "type", "bedrooms", "sizeSqft", "price", "status", "floor", "view"],
  );
  assert.deepEqual(ignored, ["Notes"]);
  assert.deepEqual(
    matchColumns(["unit", "bedrooms", "sqft", "price"]).columns.map((c) => c.field),
    ["unitNo", "bedrooms", "sizeSqft", "price"],
  );
  assert.deepEqual(
    matchColumns(["رقم الوحدة", "السعر"]).columns.map((c) => c.field),
    ["unitNo", "price"],
  );
});

test("reads amounts, bedrooms, types and statuses leniently", () => {
  assert.equal(parseAmount("AED 1,450,000"), 1450000);
  assert.equal(parseAmount("1.45M"), 1450000);
  assert.equal(parseAmount("950k"), 950000);
  assert.equal(parseAmount("1 250 sq ft"), 1250);
  assert.equal(parseAmount("١٬٢٥٠٬٠٠٠"), 1250000);
  assert.equal(parseAmount("call us"), null);

  assert.equal(parseBedrooms("Studio"), 0);
  assert.equal(parseBedrooms("0"), 0);
  assert.equal(parseBedrooms("2 BR"), 2);
  assert.equal(parseBedrooms("3 bedrooms + maid"), 3);
  assert.equal(parseBedrooms("2.0"), 2);
  assert.equal(parseBedrooms("1.5"), null);
  assert.equal(parseBedrooms("two"), null);

  assert.equal(parseType("Apartment"), "apartment");
  assert.equal(parseType("Town House"), "townhouse");
  assert.equal(parseType("PH"), "penthouse");
  assert.equal(parseType("castle"), null);

  assert.equal(parseStatus("Available"), "available");
  assert.equal(parseStatus("On hold"), "reserved");
  assert.equal(parseStatus("SOLD"), "sold");
  assert.equal(parseStatus("maybe"), null);
});

test("finds the header below a title row and explains each bad row", () => {
  const parsed = parseSheet(
    sheet([
      ["Marina Crest price list, October"],
      ["Unit", "Type", "Bedrooms", "Price"],
      ["A-1", "Apartment", "2", "2,000,000"],
      ["A-2", "Castle", "2", "abc"],
      ["", "Villa", "4", "5000000"],
      ["A-1", "Apartment", "1", "1"],
      ["A-3", "Apartment", "99", "1000000"],
      ["", "", "", ""],
    ]),
  );
  assert.ok(parsed);
  assert.deepEqual(
    parsed.rows.map((r) => [r.row, r.data.unitNo, r.data.bedrooms, r.data.price]),
    [[3, "A-1", 2, 2000000]],
  );
  assert.deepEqual(
    parsed.errors.map((e) => e.row),
    [4, 5, 6, 7],
  );
  assert.match(parsed.errors[0].message, /Type “Castle” isn't apartment/);
  assert.match(parsed.errors[0].message, /Price “abc” isn't an amount/);
  assert.match(parsed.errors[1].message, /unit number is missing/);
  assert.match(parsed.errors[2].message, /already on row 3/);
  assert.match(parsed.errors[3].message, /Bedrooms can be at most 20/);
});

test("a studio type sets bedrooms to 0 and square metres become square feet", () => {
  const parsed = parseSheet(sheet([["Unit", "Type", "Size (sqm)", "Price"], ["S-1", "Studio", "40", "700000"]]));
  assert.deepEqual(parsed?.rows[0].data, { unitNo: "S-1", type: "apartment", bedrooms: 0, sizeSqft: 431, price: 700000 });
});

test("a sheet without a unit column has no header", () => {
  assert.equal(parseSheet(sheet([["Name", "Price"], ["x", "1"]])), null);
  assert.throws(() => buildPreview("x.csv", [sheet([["Name"]])], []), { message: NO_HEADER });
});

test("plans adds and updates, matching unit numbers without case", () => {
  const plan = planImport(
    [
      { unitNo: "a-0701", price: 1500000, view: "Marina" }, // only the price changes
      { unitNo: "A-0702", type: "apartment", bedrooms: 1, price: 1400000 },
      { unitNo: "A-0703", price: 1400000 }, // new, but no type or bedrooms
    ],
    existing,
  );
  assert.equal(plan.add.length, 1);
  assert.deepEqual(plan.update.map((u) => [u.id, u.row.unitNo, u.changes]), [["u1", "A-0701", ["price"]]]);
  assert.deepEqual(plan.missing.map((m) => m.fields), [["type", "bedrooms"]]);
  assert.equal(planImport([{ unitNo: "A-0701", price: 1450000 }], existing).unchanged, 1);
});

test("the preview lists what will change and why rows are left out", () => {
  const preview = buildPreview(
    "prices.csv",
    [
      sheet([
        ["Unit", "Price"],
        ["A-0701", "1,500,000"],
        ["B-1", "900000"],
      ]),
    ],
    existing,
  );
  assert.deepEqual(preview.update.map((u) => u.changes), [["price"]]);
  assert.equal(preview.add.length, 0);
  assert.deepEqual(preview.errors, [{ row: 3, message: "Unit B-1 is new, so it needs a type and bedrooms." }]);
  assert.deepEqual(preview.rows.map((r) => r.unitNo), ["A-0701"]);
});

test("the template reads back as three new units", async () => {
  const sheets = await readSheets(Buffer.from(`﻿${TEMPLATE_CSV}`, "utf8"), "template.csv");
  const preview = buildPreview("template.csv", sheets, []);
  assert.equal(preview.errors.length, 0);
  assert.deepEqual(
    preview.add.map((r) => [r.unitNo, r.bedrooms, r.status]),
    [
      ["A-0701", 1, "available"],
      ["S-0102", 0, "available"],
      ["TH-12", 3, "reserved"],
    ],
  );
});

test("reads Excel files, skipping a hidden sheet and keeping row numbers", async () => {
  const workbook = new Workbook();
  workbook.addWorksheet("Workings").state = "hidden";
  const ws = workbook.addWorksheet("Prices");
  ws.addRow(["Price list"]);
  ws.addRow([]);
  ws.addRow(["Unit", "Type", "Beds", "Price (AED)", "Status"]);
  ws.addRow(["PH-1", "Penthouse", 4, 9800000, "Sold"]);
  ws.addRow([1203, "Apartment", "Studio", { formula: "900000+50000", result: 950000 }, "Available"]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

  const sheets = await readSheets(buffer, "prices.xlsx");
  assert.equal(sheets.length, 1);
  const preview = buildPreview("prices.xlsx", sheets, []);
  assert.equal(preview.sheet, "Prices");
  assert.deepEqual(
    preview.add.map((r) => [r.unitNo, r.type, r.bedrooms, r.price, r.status]),
    [
      ["PH-1", "penthouse", 4, 9800000, "sold"],
      ["1203", "apartment", 0, 950000, "available"],
    ],
  );
});

test("refuses other file types and damaged spreadsheets plainly", async () => {
  await assert.rejects(readSheets(Buffer.from("x"), "prices.xls"), SheetError);
  await assert.rejects(readSheets(Buffer.from(""), "prices.csv"), /empty/);
  await assert.rejects(readSheets(Buffer.from("not a zip"), "prices.xlsx"), /couldn't be read/);
});
