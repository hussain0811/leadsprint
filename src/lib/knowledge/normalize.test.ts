import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeText, tokenize } from "./normalize";

test("folds case, compatibility forms and Arabic letter variants", () => {
  assert.equal(normalizeText("Ｄubai MARINA"), "dubai marina");
  assert.equal(normalizeText("مُحَمَّد"), "محمد");
  assert.equal(normalizeText("شـــقة"), "شقه");
  assert.equal(normalizeText("أحمد إبراهيم آمنة ٱلله"), "احمد ابراهيم امنه الله");
  assert.equal(normalizeText("مستشفى"), "مستشفي");
});

test("turns Arabic-Indic and Persian digits into 0-9 and joins digit groups", () => {
  assert.equal(normalizeText("١٢٣ ۴۵۶"), "123 456");
  assert.equal(normalizeText("AED 1,500,000"), "aed 1500000");
  assert.equal(normalizeText("١٬٥٠٠٬٠٠٠ درهم"), "1500000 درهم");
  assert.equal(normalizeText("٢٫٥ مليون"), "2.5 مليون");
  // Not thousands groups: a list, and a decimal comma.
  assert.equal(normalizeText("1,2,3 and 1,5"), "1,2,3 and 1,5");
});

test("English tokens drop stopwords and plural endings", () => {
  assert.deepEqual(tokenize("What are the prices of the 2 bedroom apartments?"), ["price", "2", "bedroom", "apartment"]);
  assert.deepEqual(tokenize("Properties with sea views"), ["property", "sea", "view"]);
  // Short words, and words that only look plural, stay whole.
  assert.deepEqual(tokenize("bus status address"), ["bus", "status", "address"]);
  // Real estate terms built from common words survive.
  assert.deepEqual(tokenize("Is there an off-plan down payment?"), ["off", "plan", "down", "payment"]);
});

test("Arabic tokens drop stopwords and the article prefixes", () => {
  assert.deepEqual(tokenize("ما هو سعر الشقة في المارينا؟"), ["سعر", "شقه", "مارينا"]);
  assert.deepEqual(tokenize("والمسبح بالدرهم للبيع كالمعتاد فالسعر"), ["مسبح", "درهم", "بيع", "معتاد", "سعر"]);
  assert.deepEqual(tokenize("كم سعر ٣ غرف؟"), ["سعر", "3", "غرف"]);
  // A word that merely starts with "ال" keeps at least two letters.
  assert.deepEqual(tokenize("ألف"), ["الف"]);
});

test("a question and a document written differently give the same tokens", () => {
  assert.deepEqual(tokenize("السِّعر للشُّقَّة"), tokenize("سعر الشقه"));
  assert.deepEqual(tokenize("PRICE: 1,200,000"), tokenize("price 1200000"));
  assert.deepEqual(tokenize("السعر ١٬٢٠٠٬٠٠٠"), tokenize("سعر 1200000"));
});
