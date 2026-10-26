import { ValueType, Workbook, type Cell, type CellValue } from "exceljs";
import Papa from "papaparse";

// Reads the cells of an uploaded price list (CSV or Excel .xlsx) as text, row by row.

export class SheetError extends Error {}

export type SheetRow = { row: number; cells: string[] }; // row: the number shown in Excel, from 1
export type Sheet = { name: string | null; rows: SheetRow[] };

// Price lists rarely run past a few thousand units; this only stops a runaway file.
const MAX_ROWS = 10_000;

export function sheetKind(fileName: string): "csv" | "xlsx" | null {
  const ext = /\.[^./\\]+$/.exec(fileName.trim().toLowerCase())?.[0];
  if (ext === ".csv") return "csv";
  if (ext === ".xlsx") return "xlsx";
  return null;
}

export const UNSUPPORTED_SHEET = "Upload the price list as a CSV or Excel (.xlsx) file. Old .xls files need to be saved as .xlsx first.";

/** All visible sheets of the file (a CSV has one), each with its non-empty rows. */
export async function readSheets(buffer: Buffer, fileName: string): Promise<Sheet[]> {
  const kind = sheetKind(fileName);
  if (!kind) throw new SheetError(UNSUPPORTED_SHEET);
  if (buffer.length === 0) throw new SheetError("This file is empty. Check that you picked the right file.");
  if (kind === "csv") return [{ name: null, rows: readCsv(buffer) }];
  // An .xlsx is a zip: a small upload can unpack to gigabytes, so check its declared size before opening it.
  const unpacked = zipUncompressedSize(buffer);
  if (unpacked === null) {
    throw new SheetError(
      "This Excel file couldn't be read. It may be damaged, or an old .xls file renamed to .xlsx. Open it in Excel, save it as .xlsx and upload it again.",
    );
  }
  if (unpacked > MAX_UNZIPPED_BYTES) {
    throw new SheetError("This Excel file is too large once opened. Remove pictures or extra sheets, or save the price list as CSV, and try again.");
  }
  try {
    return await readXlsx(buffer);
  } catch {
    throw new SheetError(
      "This Excel file couldn't be read. It may be damaged, or an old .xls file renamed to .xlsx. Open it in Excel, save it as .xlsx and upload it again.",
    );
  }
}

export const MAX_UNZIPPED_BYTES = 50 * 1024 * 1024;

/**
 * The total uncompressed size a zip file declares in its central directory, or null when the
 * directory can't be found or read. Zip64 archives (sizes over 4 GB) report Infinity.
 */
export function zipUncompressedSize(buffer: Buffer): number | null {
  // The end-of-central-directory record sits in the last 22 bytes, plus a comment of up to 64 KB.
  const EOCD = 0x06054b50;
  const CENTRAL = 0x02014b50;
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 0xffff); i--) {
    if (buffer.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const entries = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  if (entries === 0xffff || offset === 0xffffffff) return Infinity;
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL) return null;
    const size = buffer.readUInt32LE(offset + 24);
    if (size === 0xffffffff) return Infinity;
    total += size;
    offset += 46 + buffer.readUInt16LE(offset + 28) + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
  return total;
}

function readCsv(buffer: Buffer): SheetRow[] {
  const text = decodeText(buffer);
  if (text.includes("\u0000")) throw new SheetError("This doesn't look like a CSV file. Save the price list as CSV or .xlsx and try again.");
  // A file saved with semicolons (common with European Excel settings) is detected by Papa.
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: false });
  const rows: SheetRow[] = [];
  parsed.data.forEach((cells, i) => {
    if (rows.length >= MAX_ROWS) return;
    const clean = cells.map((cell) => tidy(String(cell ?? "")));
    if (clean.some(Boolean)) rows.push({ row: i + 1, cells: clean });
  });
  return rows;
}

async function readXlsx(buffer: Buffer): Promise<Sheet[]> {
  const workbook = new Workbook();
  // exceljs types its input as an ArrayBuffer; a copy is one.
  await workbook.xlsx.load(new Uint8Array(buffer).buffer);
  const sheets: Sheet[] = [];
  for (const sheet of workbook.worksheets) {
    if (sheet.state !== "visible") continue;
    const rows: SheetRow[] = [];
    sheet.eachRow((row, rowNumber) => {
      if (rows.length >= MAX_ROWS) return;
      const cells: string[] = [];
      row.eachCell((cell, col) => {
        if (cell.type === ValueType.Merge) return;
        cells[col - 1] = cellText(cell);
      });
      const filled = Array.from(cells, (value) => value ?? "");
      if (filled.some(Boolean)) rows.push({ row: rowNumber, cells: filled });
    });
    sheets.push({ name: sheet.name, rows });
  }
  return sheets;
}

function cellText(cell: Cell): string {
  const value = plainValue(cell.value);
  if (value === null) return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  return tidy(String(value));
}

// Unwraps rich text, links and formulas to the value a reader sees in Excel.
function plainValue(value: CellValue): string | number | boolean | Date | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || value instanceof Date) return value;
  if ("richText" in value) return value.richText.map((part) => part.text).join("");
  if ("hyperlink" in value) return plainValue(value.text as CellValue);
  if ("result" in value && value.result !== undefined) return plainValue(value.result);
  return null;
}

function tidy(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

// UTF-8 (BOM removed), UTF-16 with a BOM, or else the Windows code page: Excel's plain "CSV"
// uses it, and in the Gulf that's Arabic (windows-1256).
function decodeText(buffer: Buffer): string {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder("utf-16le").decode(buffer);
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder("utf-16be").decode(buffer);
  const utf8 = new TextDecoder("utf-8").decode(buffer);
  const invalid = utf8.match(/�/g)?.length ?? 0;
  if (invalid === 0) return utf8;
  const nonAscii = buffer.reduce((n, byte) => n + (byte >= 0x80 ? 1 : 0), 0);
  return invalid >= nonAscii * 0.2 ? new TextDecoder("windows-1256").decode(buffer) : utf8;
}
