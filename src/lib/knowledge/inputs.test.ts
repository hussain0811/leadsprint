import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acceptedExtension,
  normalizePageAddress,
  projectIdSchema,
  safeFileName,
  titleFromFileName,
  validUntilSchema,
} from "./inputs";

test("storage file names keep letters in any script and drop everything risky", () => {
  assert.equal(safeFileName("Marina Crest brochure (v2).PDF"), "Marina_Crest_brochure_v2.pdf");
  assert.equal(safeFileName("كتيب المشروع.pdf"), "كتيب_المشروع.pdf");
  assert.equal(safeFileName("../../etc/passwd.txt"), "passwd.txt");
  assert.equal(safeFileName("C:\\Users\\me\\price list.xlsx"), "price_list.xlsx");
  assert.equal(safeFileName("CON.txt"), "_CON.txt");
  assert.equal(safeFileName("....md"), "file.md");
});

test("only the accepted document types are allowed", () => {
  assert.equal(acceptedExtension("Brochure.PDF"), ".pdf");
  assert.equal(acceptedExtension("faq.md"), ".md");
  assert.equal(acceptedExtension("setup.exe"), null);
  assert.equal(acceptedExtension("pdf"), null);
  assert.equal(acceptedExtension(".pdf"), null);
  assert.equal(titleFromFileName("Price list 2026.xlsx"), "Price list 2026");
});

test("valid-until dates last through the end of the day", () => {
  assert.equal(validUntilSchema.parse("2026-12-31")?.toISOString(), "2026-12-31T23:59:59.999Z");
  assert.equal(validUntilSchema.parse(""), null);
  assert.equal(validUntilSchema.parse(null), null);
  assert.equal(validUntilSchema.safeParse("2026-02-30").success, false);
  assert.equal(validUntilSchema.safeParse("31/12/2026").success, false);
});

test("an empty project means all projects", () => {
  assert.equal(projectIdSchema.parse(""), null);
  assert.equal(projectIdSchema.parse(null), null);
  assert.equal(projectIdSchema.parse(" p1 "), "p1");
});

test("page addresses without a scheme get https", () => {
  assert.equal(normalizePageAddress(" example.com/page "), "https://example.com/page");
  assert.equal(normalizePageAddress("http://example.com"), "http://example.com");
});
