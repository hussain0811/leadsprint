import assert from "node:assert/strict";
import { test } from "node:test";
import { Workbook } from "exceljs";
import { extractText, htmlToText } from "./extract";
import { ExtractError } from "./types";

const file = (fileName: string, content: string | Buffer) => ({
  fileName,
  buffer: typeof content === "string" ? Buffer.from(content, "utf8") : content,
});

// A minimal PDF with one line of Helvetica text per page (an empty string makes a page with no text).
function minimalPdf(pageTexts: string[]): Buffer {
  const objects: string[] = [];
  const pageIds = pageTexts.map((_, i) => 4 + i * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pageTexts.forEach((text, i) => {
    const content = text ? `BT /F1 18 Tf 72 720 Td (${text}) Tj ET` : "";
    objects[pageIds[i]] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`;
    objects[pageIds[i] + 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = pdf.length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

test("reads text files as UTF-8 without the BOM", async () => {
  const result = await extractText(file("notes.txt", "﻿Handover in Q4 2026.\r\nسعر الشقة ١٬٢٠٠٬٠٠٠ درهم\r\n"));
  assert.deepEqual(result, { pages: [{ page: null, text: "Handover in Q4 2026.\nسعر الشقة ١٬٢٠٠٬٠٠٠ درهم" }], title: null });
});

test("takes a Markdown file's title from its first heading", async () => {
  const result = await extractText(file("faq.md", "# Marina Heights FAQ\n\n## Parking\nOne space per unit."));
  assert.equal(result.title, "Marina Heights FAQ");
  assert.equal(result.pages[0].text, "# Marina Heights FAQ\n\n## Parking\nOne space per unit.");
});

test("turns CSV rows into Header: value lines", async () => {
  const csv = 'Unit,Bedrooms,Price (AED),Notes\nA-101,2,"1,200,000",\nA-102,3,"1,650,000","Sea view,\nhigh floor"\n\n';
  const result = await extractText(file("units.csv", csv));
  assert.deepEqual(result.pages, [
    {
      page: null,
      text: "Unit: A-101; Bedrooms: 2; Price (AED): 1,200,000\nUnit: A-102; Bedrooms: 3; Price (AED): 1,650,000; Notes: Sea view, high floor",
    },
  ]);
});

test("reads a CSV saved by Excel with the Arabic Windows code page", async () => {
  // "سعر" in windows-1256, as Excel's plain "CSV" format saves it on Arabic Windows.
  const bytes = Buffer.concat([Buffer.from("Item,Price\r\n"), Buffer.from([0xd3, 0xda, 0xd1]), Buffer.from(",100\r\n")]);
  const result = await extractText(file("prices.csv", bytes));
  assert.equal(result.pages[0].text, "Item: سعر; Price: 100");
});

test("a damaged byte in a UTF-8 file doesn't garble the rest", async () => {
  const bytes = Buffer.concat([Buffer.from("سعر الشقة مليون درهم "), Buffer.from([0xff]), Buffer.from("مع إطلالة على البحر")]);
  const result = await extractText(file("notes.txt", bytes));
  assert.equal(result.pages[0].text, "سعر الشقة مليون درهم �مع إطلالة على البحر");
});

test("reads each visible sheet of a workbook, with its name as a heading", async () => {
  const workbook = new Workbook();
  const units = workbook.addWorksheet("Units");
  units.addRow(["Marina Heights price list"]);
  units.mergeCells("A1:C1");
  units.addRow(["Unit", "Bedrooms", "Price"]);
  units.addRow(["A-101", 2, 1_200_000]);
  units.addRow(["A-102", 3, { formula: "C3*1.5", result: 1_800_000 }]);
  units.addRow(["A-103", 1, 900_000]).hidden = true;

  const plan = workbook.addWorksheet("Payment plan");
  plan.addRow(["Milestone", "Share", "Due"]);
  plan.addRow(["Booking", 0.2, new Date(Date.UTC(2026, 0, 15))]);
  plan.getCell("B2").numFmt = "0%";

  const margins = workbook.addWorksheet("Margins", { state: "hidden" });
  margins.addRow(["Unit", "Cost"]);
  margins.addRow(["A-101", 800_000]);

  const result = await extractText(file("prices.xlsx", Buffer.from(await workbook.xlsx.writeBuffer())));
  assert.deepEqual(result, {
    pages: [
      {
        page: null,
        text: "# Units\n\nMarina Heights price list\nUnit: A-101; Bedrooms: 2; Price: 1200000\nUnit: A-102; Bedrooms: 3; Price: 1800000",
      },
      { page: null, text: "# Payment plan\n\nMilestone: Booking; Share: 20%; Due: 2026-01-15" },
    ],
    title: null,
  });
});

test("reads each PDF page as its own page", async () => {
  const pdf = minimalPdf(["Marina Heights payment plan: 20% on booking", "", "Handover is planned for December 2026"]);
  const result = await extractText(file("brochure.pdf", pdf));
  assert.deepEqual(result, {
    pages: [
      { page: 1, text: "Marina Heights payment plan: 20% on booking" },
      { page: 2, text: "" },
      { page: 3, text: "Handover is planned for December 2026" },
    ],
    title: null,
  });
});

test("explains that a PDF without selectable text is probably a scan", async () => {
  await assert.rejects(
    extractText(file("scan.pdf", minimalPdf(["", ""]))),
    (err) => err instanceof ExtractError && /scan/.test(err.message) && /later version/.test(err.message),
  );
});

test("explains unsupported, old-format, empty and damaged files", async () => {
  const rejectsWith = (name: string, content: string, pattern: RegExp) =>
    assert.rejects(extractText(file(name, content)), (err) => err instanceof ExtractError && pattern.test(err.message));

  await rejectsWith("photo.jpg", "x", /\.jpg files aren't supported\. Upload a PDF, Word \(\.docx\), Excel \(\.xlsx\), CSV/);
  await rejectsWith("photo.jpg", "x", /\.doc and \.xls files need to be saved as \.docx or \.xlsx/);
  await rejectsWith("brochure.doc", "x", /save it as \.docx/);
  await rejectsWith("prices.xls", "x", /save it as \.xlsx/);
  await rejectsWith("notes.txt", "", /empty/);
  await rejectsWith("broken.docx", "not a zip file", /Word file couldn't be read/);
  await rejectsWith("broken.pdf", "not a pdf", /PDF couldn't be read/);
  await rejectsWith("blank.md", " \n\n ", /No text was found/);
});

test("turns HTML into text with headings, leaving out page furniture", () => {
  const html = `<!doctype html><html><head><title>Marina Heights &amp; Co</title><style>p { color: red }</style></head>
    <body><header><nav><a href="/">Home</a></nav></header>
    <main><article><header><h1>Marina <em>Heights</em></h1></header>
      <p>Prices from AED&nbsp;1,200,000 &ndash; ready in 2026.</p>
      <script>const html = "<p>not text</p>";</script>
      <h2>Amenities</h2><ul><li>Pool</li><li>Gym</li></ul>
      <table><tr><th>Unit</th><th>Price</th></tr><tr><td>A-101</td><td><p>1,200,000</p></td></tr></table>
      <svg viewBox="0 0 1 1"><title>icon</title></svg><noscript>Turn on JavaScript</noscript>
    </article></main><footer>© 2026 Example</footer></body></html>`;
  assert.deepEqual(htmlToText(html), {
    title: "Marina Heights & Co",
    text: "# Marina Heights\n\nPrices from AED 1,200,000 – ready in 2026.\n\n# Amenities\n\n- Pool\n- Gym\n\nUnit | Price\nA-101 | 1,200,000",
  });
});

test("unclosed tags, quotes and comments in a large page don't slow reading down", () => {
  const size = 1024 * 1024;
  const pages = ["<a", '<a href="', "<a href='", "<!--", "<!x", "<?x", "</p"].map((open) => open.repeat(size / open.length));
  pages.push(`<p>Start</p><div class="${"x".repeat(size)}`);
  for (const html of pages) {
    const start = performance.now();
    htmlToText(html);
    const ms = performance.now() - start;
    assert.ok(ms < 1000, `${html.slice(0, 12)}… took ${Math.round(ms)} ms`);
  }
  // As in browsers, an unclosed tag at the end swallows what follows it.
  assert.equal(htmlToText("<p>Price: AED 1,200,000</p><img alt='x").text, "Price: AED 1,200,000");
});

test("takes an HTML title from the first h1 when there is no <title>", () => {
  const result = htmlToText("<h2>Welcome</h2><h1>Payment&#32;plan</h1><p>&#1587;&#x639;&#1585; <span>3</span><span>Beds</span></p>");
  assert.equal(result.title, "Payment plan");
  assert.equal(result.text, "# Welcome\n\n# Payment plan\n\nسعر 3 Beds");
});
