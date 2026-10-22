import { ValueType, Workbook, type Cell, type CellValue, type Worksheet } from "exceljs";
import mammoth from "mammoth";
import Papa from "papaparse";
import { extractText as readPdfPages, getDocumentProxy } from "unpdf";
import { ACCEPTED_EXTENSIONS, ExtractError, type ExtractedPage, type ExtractResult } from "./types";

type Extension = (typeof ACCEPTED_EXTENSIONS)[number];

// The first rows of a sheet are enough to answer from; huge exports would swamp the search index.
const MAX_ROWS_PER_SHEET = 5_000;
// Title rows above a sheet's header are only looked for this far down.
const HEADER_SEARCH_ROWS = 10;
// Scans often still carry a stray letter or two (a stamp, a logo), so "no text" means almost none.
const MIN_LETTERS_PER_PAGE = 10;
// In Arabic windows-1256 text nearly every byte above 127 is invalid UTF-8; in a UTF-8 file with
// a damaged byte, almost none are.
const MIN_INVALID_SHARE = 0.2;

const SUPPORTED = "a PDF, Word (.docx), Excel (.xlsx), CSV, text (.txt) or Markdown (.md) file";

// Only used when the file name has no extension.
const MIME_EXTENSIONS = new Map<string, Extension>([
  ["application/pdf", ".pdf"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx"],
  ["text/csv", ".csv"],
  ["text/plain", ".txt"],
  ["text/markdown", ".md"],
]);

const READERS: Record<Extension, (buffer: Buffer) => Promise<ExtractResult>> = {
  ".pdf": readPdf,
  ".docx": readDocx,
  ".xlsx": readXlsx,
  ".csv": async (buffer) => readCsv(buffer),
  ".txt": async (buffer) => readPlainText(buffer, false),
  ".md": async (buffer) => readPlainText(buffer, true),
};

/**
 * Extracts readable text from an uploaded file, page by page where the format has pages.
 * Supports .pdf, .docx, .xlsx, .csv, .txt and .md. Throws ExtractError (from ./types) with an
 * admin-friendly message for unsupported, empty or unreadable files.
 */
export async function extractText(input: { buffer: Buffer; fileName: string; mimeType?: string | null }): Promise<ExtractResult> {
  const ext = fileExtension(input.fileName, input.mimeType);
  if (!isSupported(ext)) throw new ExtractError(unsupportedMessage(ext));
  if (input.buffer.length === 0) throw new ExtractError("This file is empty. Check that you picked the right file.");

  let result: ExtractResult;
  try {
    result = await READERS[ext](input.buffer);
  } catch (err) {
    if (err instanceof ExtractError) throw err;
    throw new ExtractError(unreadableMessage(ext, err));
  }
  if (!result.pages.some((page) => page.text.trim())) {
    throw new ExtractError("No text was found in this file. If it only holds pictures or scans, upload a version with text.");
  }
  return result;
}

function fileExtension(fileName: string, mimeType?: string | null): string {
  const ext = /\.[^./\\]+$/.exec(fileName.trim().toLowerCase())?.[0] ?? "";
  return ext || MIME_EXTENSIONS.get((mimeType ?? "").split(";")[0].trim().toLowerCase()) || "";
}

function isSupported(ext: string): ext is Extension {
  return (ACCEPTED_EXTENSIONS as readonly string[]).includes(ext);
}

function unsupportedMessage(ext: string): string {
  if (ext === ".doc") return "Old Word files (.doc) can't be read. Open the file in Word, save it as .docx and upload that.";
  if (ext === ".xls") return "Old Excel files (.xls) can't be read. Open the file in Excel, save it as .xlsx and upload that.";
  const kind = ext ? `${ext} files aren't supported.` : "This type of file isn't supported.";
  return `${kind} Upload ${SUPPORTED}. Old .doc and .xls files need to be saved as .docx or .xlsx first.`;
}

function unreadableMessage(ext: Extension, err: unknown): string {
  switch (ext) {
    case ".pdf":
      if ((err as Error)?.name === "PasswordException") {
        return "This PDF is protected with a password. Remove the password and upload it again.";
      }
      return "This PDF couldn't be read. It may be damaged; try saving or exporting it again, then upload the new copy.";
    case ".docx":
      return "This Word file couldn't be read. It may be damaged, or an old .doc file renamed to .docx. Open it in Word, save it as .docx and upload it again.";
    case ".xlsx":
      return "This Excel file couldn't be read. It may be damaged, or an old .xls file renamed to .xlsx. Open it in Excel, save it as .xlsx and upload it again.";
    default:
      return "This file couldn't be read. Check that it's a plain text file and upload it again.";
  }
}

/* ---------- PDF ---------- */

async function readPdf(buffer: Buffer): Promise<ExtractResult> {
  // pdf.js refuses Node Buffers and may take over the memory it's given, so it gets its own copy.
  const pdf = await getDocumentProxy(new Uint8Array(buffer), { verbosity: 0 });
  try {
    const { text } = await readPdfPages(pdf, { mergePages: false });
    const pages = text.map((pageText, i) => ({ page: i + 1, text: tidyPdfText(pageText) }));
    const letters = pages.reduce((sum, page) => sum + (page.text.match(/\p{L}/gu)?.length ?? 0), 0);
    if (letters < Math.max(1, pages.length) * MIN_LETTERS_PER_PAGE) {
      throw new ExtractError(
        "This PDF has little or no selectable text, so it's probably a scan. Scanned pages will be read by your AI model in a later version; for now, upload a PDF with selectable text.",
      );
    }
    return { pages, title: null };
  } finally {
    // Frees the parsed document; unpdf leaves this to the caller when it's handed a proxy.
    await pdf.loadingTask.destroy();
  }
}

function tidyPdfText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ---------- Word ---------- */

async function readDocx(buffer: Buffer): Promise<ExtractResult> {
  const { value } = await mammoth.convertToHtml(
    { buffer },
    {
      // Word's Title style names the document; keep it as a heading like Heading 1.
      styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh"],
      // Pictures carry no text, so don't spend memory encoding them into the HTML.
      convertImage: mammoth.images.imgElement(async () => ({ src: "" })),
    },
  );
  const { title, text } = htmlToText(value);
  return { pages: [{ page: null, text }], title };
}

/* ---------- Spreadsheets ---------- */

async function readXlsx(buffer: Buffer): Promise<ExtractResult> {
  const workbook = new Workbook();
  // exceljs types its input as an ArrayBuffer; a copy is one, and JSZip reads it the same way.
  await workbook.xlsx.load(new Uint8Array(buffer).buffer);
  const pages: ExtractedPage[] = [];
  for (const sheet of workbook.worksheets) {
    // Hidden sheets, rows and columns usually hold workings that aren't meant for customers.
    if (sheet.state !== "visible") continue;
    const body = tableText(sheetRows(sheet), true);
    if (body) pages.push({ page: null, text: `# ${sheet.name}\n\n${body}` });
  }
  return { pages, title: null };
}

function sheetRows(sheet: Worksheet): string[][] {
  const rows: string[][] = [];
  const hiddenColumns = new Map<number, boolean>();
  const isHiddenColumn = (col: number) => {
    if (!hiddenColumns.has(col)) hiddenColumns.set(col, sheet.getColumn(col).hidden);
    return hiddenColumns.get(col);
  };
  sheet.eachRow((row) => {
    if (row.hidden || rows.length >= MAX_ROWS_PER_SHEET + HEADER_SEARCH_ROWS) return;
    const cells: string[] = [];
    row.eachCell((cell, col) => {
      // A merged range repeats its value in every cell; the first one is enough.
      if (cell.type === ValueType.Merge || isHiddenColumn(col)) return;
      cells[col - 1] = cellText(cell);
    });
    rows.push(Array.from(cells, (value) => value ?? ""));
  });
  return rows;
}

function cellText(cell: Cell): string {
  const value = plainValue(cell.value);
  if (value === null) return "";
  // Percentages are stored as fractions (0.2) and only shown as 20% by the cell's format.
  if (typeof value === "number" && cell.numFmt?.includes("%")) return `${Number((value * 100).toFixed(6))}%`;
  if (value instanceof Date) return dateText(value);
  return String(value).replace(/\s+/g, " ").trim();
}

// Unwraps rich text, links and formulas to the value a reader sees in Excel.
function plainValue(value: CellValue): string | number | boolean | Date | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || value instanceof Date) return value;
  if ("richText" in value) return value.richText.map((part) => part.text).join("");
  if ("hyperlink" in value) return plainValue(value.text as CellValue);
  if ("result" in value && value.result !== undefined) return plainValue(value.result);
  return null; // errors, and formulas Excel never calculated
}

function dateText(date: Date): string {
  if (Number.isNaN(date.getTime())) return "";
  const iso = date.toISOString();
  return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso.slice(0, 16).replace("T", " ");
}

function readCsv(buffer: Buffer): ExtractResult {
  const parsed = Papa.parse<string[]>(decodeText(buffer), { skipEmptyLines: "greedy" });
  const rows = parsed.data.map((row) => row.map((cell) => String(cell ?? "").replace(/\s+/g, " ").trim()));
  return { pages: [{ page: null, text: tableText(rows, false) }], title: null };
}

// One "Header: value; Header: value" line per row, which reads well to people and to the AI.
function tableText(rows: string[][], findHeader: boolean): string {
  const filled = rows.filter((row) => row.some(Boolean));
  if (filled.length === 0) return "";

  // Sheets often start with a title row; the header is then the first row with two or more labels.
  let headerAt = 0;
  if (findHeader) headerAt = Math.max(0, filled.slice(0, HEADER_SEARCH_ROWS).findIndex((row) => row.filter(Boolean).length >= 2));
  const header = filled[headerAt];
  const label = (i: number) => header[i] || `Column ${i + 1}`;

  const lines = filled.slice(0, headerAt).map((row) => row.filter(Boolean).join(" "));
  const data = filled.slice(headerAt + 1, headerAt + 1 + MAX_ROWS_PER_SHEET);
  for (const row of data) {
    const pairs = row.flatMap((value, i) => (value ? [`${label(i)}: ${value}`] : []));
    if (pairs.length) lines.push(pairs.join("; "));
  }
  // A lone row is content, not a header.
  if (data.length === 0) lines.push(header.filter(Boolean).join("; "));
  return lines.join("\n");
}

/* ---------- Plain text ---------- */

function readPlainText(buffer: Buffer, markdown: boolean): ExtractResult {
  const text = decodeText(buffer).replace(/\r\n?/g, "\n");
  if (text.includes("\u0000")) {
    throw new ExtractError("This file doesn't contain plain text. Check that it really is a text or Markdown file.");
  }
  const title = markdown ? /^#[ \t]+(.+)$/m.exec(text)?.[1].replace(/#+\s*$/, "").trim() || null : null;
  return { pages: [{ page: null, text: text.trim() }], title };
}

// UTF-8 (BOM removed), UTF-16 with a BOM, or else the Windows code page: Excel's plain "CSV"
// and older Notepad files use it, and in the Gulf that's Arabic (windows-1256).
function decodeText(buffer: Buffer): string {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder("utf-16le").decode(buffer);
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder("utf-16be").decode(buffer);
  const utf8 = new TextDecoder("utf-8").decode(buffer);
  // A stray bad byte in a UTF-8 file must not garble the rest of it; only text that is mostly
  // invalid as UTF-8 is read with the code page.
  const invalid = utf8.match(/�/g)?.length ?? 0;
  if (invalid === 0) return utf8;
  const nonAscii = buffer.reduce((n, byte) => n + (byte >= 0x80 ? 1 : 0), 0);
  return invalid >= nonAscii * MIN_INVALID_SHARE ? new TextDecoder("windows-1256").decode(buffer) : utf8;
}

/* ---------- HTML ---------- */

// Page furniture and things that aren't text. Header and footer inside <main> or <article> are
// part of the content (an article's own title), so only the page-level ones are dropped.
const DROP = new Set(["script", "style", "noscript", "svg", "nav", "header", "footer", "head", "template", "iframe", "object", "select"]);
// These end only at their own closing tag, whatever they contain (a script may hold "<div>").
const RAW_TEXT = new Set(["script", "style", "title", "textarea", "xmp"]);
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const PARAGRAPH = new Set([
  "address", "article", "aside", "blockquote", "details", "dialog", "div", "dl", "fieldset", "figure", "form", "hgroup",
  "main", "ol", "p", "pre", "section", "table", "ul",
]);
const LINE = new Set(["br", "caption", "dd", "dt", "figcaption", "hr", "legend", "option", "summary"]);
// Layouts often place these side by side with no space between them in the markup.
const SPACED = new Set(["button", "img", "input", "label", "span"]);
// Every token may end at the end of the input, as in browsers. Without that, each unclosed tag
// scans to the end and fails, which makes a large page take minutes.
const HTML_TOKEN =
  /<!--[\s\S]*?(?:-->|$)|<![^>]*(?:>|$)|<\?[^>]*(?:>|$)|<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*(?:"|$)|'[^']*(?:'|$))*)(?:>|$)|[^<]+|</g;

const ENTITIES = new Map(
  Object.entries({
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
    lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»", bull: "•", middot: "·", copy: "©",
    reg: "®", trade: "™", deg: "°", times: "×", divide: "÷", euro: "€", pound: "£", cent: "¢", yen: "¥",
    sup2: "²", sup3: "³", frac12: "½", frac14: "¼", frac34: "¾", shy: "­", zwnj: "‌", zwj: "‍",
    lrm: "‎", rlm: "‏",
  }),
);

/** Converts an HTML page to plain text, keeping headings as "# Heading" lines. */
export function htmlToText(html: string): { title: string | null; text: string } {
  const out: string[] = [];
  let title: string | null = null;
  let firstH1: string | null = null;
  let heading: { level: number; parts: string[] } | null = null;
  let drop: { tag: string; depth: number } | null = null;
  let landmarks = 0; // open <main> and <article> elements
  let inCell = false;

  // Inside a heading or a table cell, line breaks become spaces so the line stays whole.
  const emit = (text: string) => {
    if (heading) heading.parts.push(/^[\n\t]+$/.test(text) ? " " : text);
    else out.push(inCell && /^\n+$/.test(text) ? " " : text);
  };
  const endHeading = () => {
    if (!heading) return;
    const text = collapse(heading.parts.join(""));
    if (text && heading.level === 1 && firstH1 === null) firstH1 = text;
    heading = null;
    if (text) out.push(inCell ? ` ${text} ` : `\n\n# ${text}\n\n`);
  };

  const token = new RegExp(HTML_TOKEN.source, "g");
  for (let match = token.exec(html); match; match = token.exec(html)) {
    const [whole, slash, rawName, attrs] = match;
    if (rawName === undefined) {
      // Text, or a "<" that doesn't start a tag. Comments and doctypes start with "<!" or "<?".
      if (!drop && !/^<[!?]/.test(whole)) emit(decodeEntities(whole).replace(/\s+/g, " "));
      continue;
    }
    const name = rawName.toLowerCase();
    const closing = slash === "/";
    const selfClosing = VOID.has(name) || /\/\s*$/.test(attrs);

    if (!closing && RAW_TEXT.has(name)) {
      const end = new RegExp(`</${name}\\s*>`, "gi");
      end.lastIndex = token.lastIndex;
      const found = end.exec(html);
      const inner = html.slice(token.lastIndex, found ? found.index : html.length);
      token.lastIndex = found ? end.lastIndex : html.length;
      if (name === "title" && title === null && (!drop || drop.tag === "head")) title = collapse(decodeEntities(inner)) || null;
      if ((name === "textarea" || name === "xmp") && !drop) emit(decodeEntities(inner).replace(/\s+/g, " "));
      continue;
    }

    if (drop) {
      if (name === drop.tag && !selfClosing) drop.depth += closing ? -1 : 1;
      if (drop.depth === 0) drop = null;
      continue;
    }
    if (!closing && !selfClosing && DROP.has(name) && !(landmarks > 0 && (name === "header" || name === "footer"))) {
      drop = { tag: name, depth: 1 };
      continue;
    }

    if (name === "main" || name === "article") landmarks = Math.max(0, landmarks + (closing ? -1 : 1));
    if (/^h[1-6]$/.test(name)) {
      endHeading();
      if (!closing) heading = { level: Number(name[1]), parts: [] };
    } else if (name === "td" || name === "th") {
      // Cells are marked with tabs and joined with " | " at the end. End tags may be left out.
      inCell = !closing;
      if (!closing) emit("\t");
    } else if (name === "tr") {
      // Rows are lines of one block, so the chunker keeps a table together.
      inCell = false;
      if (!closing) emit("\n");
    } else if (name === "li") {
      if (!closing) emit(inCell ? " " : "\n- ");
    } else if (PARAGRAPH.has(name)) {
      if (name === "table") inCell = false;
      emit("\n\n");
    } else if (LINE.has(name)) {
      emit("\n");
    } else if (SPACED.has(name)) {
      emit(" ");
    }
  }
  endHeading();

  const text = out
    .join("")
    .replace(/ *\t[\t ]*/g, "\t")
    .replace(/^\t+|\t+$/gm, "")
    .replace(/\t+/g, " | ")
    .replace(/ {2,}/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/^-$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title: title ?? firstH1, text };
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z][a-z\d]{1,31}));/gi, (entity, dec, hex, name) => {
    if (name) return ENTITIES.get(name) ?? ENTITIES.get(name.toLowerCase()) ?? entity;
    const code = dec ? Number(dec) : parseInt(hex, 16);
    const valid = code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
    return valid ? String.fromCodePoint(code) : entity;
  });
}
