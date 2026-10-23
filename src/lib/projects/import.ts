import { importRowSchema, MAX_IMPORT_ROWS } from "./inputs";
import type { Sheet } from "./sheet";
import {
  IMPORT_FIELD_LABEL,
  type ImportField,
  type ImportPreview,
  type ImportRow,
  type UnitFields,
  type UnitStatus,
  type UnitType,
} from "./types";

// Turns the rows of an uploaded price list into units: finds the header, matches columns by name,
// reads each cell leniently ("AED 1,450,000", "2 BR", "Studio") and explains every row it can't use.

/* ---------- Columns ---------- */

// Headers are compared lower-cased with everything but letters and digits removed: "Size (sq ft)" is "sizesqft".
const HEADER_ALIASES: Record<ImportField, string[]> = {
  unitNo: ["unit", "unitno", "unitnumber", "unitnum", "unitid", "unitref", "unitcode", "flat", "flatno", "aptno", "apartmentno", "رقمالوحدة", "الوحدة"],
  type: ["type", "unittype", "propertytype", "category", "النوع", "نوعالوحدة", "نوعالعقار"],
  bedrooms: ["beds", "bed", "bedrooms", "bedroom", "br", "bhk", "noofbedrooms", "numberofbedrooms", "bedroomcount", "rooms", "غرفالنوم", "عددالغرف", "الغرف"],
  sizeSqft: ["size", "sqft", "sizesqft", "sizeinsqft", "sizeft2", "area", "areasqft", "builtuparea", "builtupareasqft", "bua", "totalarea", "totalareasqft", "المساحة"],
  price: ["price", "priceaed", "aed", "askingprice", "sellingprice", "saleprice", "listprice", "totalprice", "amount", "value", "السعر"],
  status: ["status", "availability", "unitstatus", "الحالة"],
  floor: ["floor", "floorno", "level", "الطابق"],
  view: ["view", "views", "facing", "الإطلالة", "الاطلالة", "الواجهة"],
};
// Sizes in square metres are converted to square feet.
const SQM_HEADERS = ["sizesqm", "sizem2", "areasqm", "aream2", "sqm", "builtupareasqm", "totalareasqm"];
const SQFT_PER_SQM = 10.7639;
const HEADER_SEARCH_ROWS = 10;

export function headerKey(header: string) {
  return header.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

type Column = { index: number; field: ImportField; header: string; sqm: boolean };

export function matchColumns(header: string[]): { columns: Column[]; ignored: string[] } {
  const columns: Column[] = [];
  const ignored: string[] = [];
  header.forEach((text, index) => {
    if (!text) return;
    const key = headerKey(text);
    const sqm = SQM_HEADERS.includes(key);
    const field = sqm ? "sizeSqft" : (Object.keys(HEADER_ALIASES) as ImportField[]).find((f) => HEADER_ALIASES[f].includes(key));
    // A second column for the same thing is left alone; the first one wins.
    if (!field || columns.some((c) => c.field === field)) ignored.push(text);
    else columns.push({ index, field, header: text, sqm });
  });
  return { columns, ignored };
}

/* ---------- Cells ---------- */

// Arabic-Indic digits and separators, as typed on Arabic keyboards.
function westernDigits(text: string) {
  return text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٬/g, ",")
    .replace(/٫/g, ".");
}

/** "AED 1,450,000", "1.45M", "950k", "1 250 sq ft" → a number; null when it isn't one. */
export function parseAmount(text: string): number | null {
  const cleaned = westernDigits(text)
    .toLowerCase()
    .replace(/aed|dhs?\b|درهم|د\.إ|sq\.?\s*ft\.?|sqft|ft2|ft²|square feet/g, "")
    .replace(/[,\s']/g, "");
  const match = /^(\d+(?:\.\d+)?|\.\d+)(k|m|mn|million)?$/.exec(cleaned);
  if (!match) return null;
  const scale = match[2] === "k" ? 1_000 : match[2] ? 1_000_000 : 1;
  return Math.round(Number(match[1]) * scale * 100) / 100;
}

const STUDIO_WORDS = ["studio", "st", "ستوديو", "استوديو"];

/** "2", "2 BR", "3 bedrooms + maid", "Studio" → a bedroom count; null when it isn't one. */
export function parseBedrooms(text: string): number | null {
  const value = westernDigits(text).toLowerCase().trim();
  if (STUDIO_WORDS.includes(value)) return 0;
  if (/^\d+$/.test(value)) return Number(value);
  // Excel may store a whole number as "2.0".
  if (/^\d+\.0+$/.test(value)) return Number(value);
  const match = /^(\d+)\s*(?:br|b\/r|bhk|beds?|bedrooms?|bed rooms?|غرف|غرفة)(?![a-z])/.exec(value);
  return match ? Number(match[1]) : null;
}

const TYPE_WORDS: Record<UnitType, string[]> = {
  apartment: ["apartment", "apartments", "apt", "flat", "duplex", "studio", "شقة", "شقق", "دوبلكس", "ستوديو", "استوديو"],
  villa: ["villa", "villas", "فيلا", "فلة"],
  townhouse: ["townhouse", "townhouses", "town house", "th", "تاون هاوس", "تاونهاوس"],
  penthouse: ["penthouse", "penthouses", "ph", "بنتهاوس", "بنت هاوس"],
};

export function parseType(text: string): UnitType | null {
  const value = text.toLowerCase().replace(/\s+/g, " ").trim();
  return (Object.keys(TYPE_WORDS) as UnitType[]).find((type) => TYPE_WORDS[type].includes(value)) ?? null;
}

const STATUS_WORDS: Record<UnitStatus, string[]> = {
  available: ["available", "avail", "vacant", "open", "for sale", "unsold", "yes", "متاح", "متاحة", "متوفر"],
  reserved: ["reserved", "booked", "hold", "on hold", "blocked", "under offer", "محجوز", "محجوزة"],
  sold: ["sold", "sold out", "no", "مباع", "مباعة"],
};

export function parseStatus(text: string): UnitStatus | null {
  const value = text.toLowerCase().replace(/\s+/g, " ").trim();
  return (Object.keys(STATUS_WORDS) as UnitStatus[]).find((status) => STATUS_WORDS[status].includes(value)) ?? null;
}

/* ---------- Rows ---------- */

export type ParsedRow = { row: number; data: ImportRow };

export type ParsedSheet = {
  columns: { field: ImportField; header: string }[];
  ignoredHeaders: string[];
  rows: ParsedRow[];
  errors: { row: number; message: string }[];
};

export const NO_HEADER =
  "Couldn't find the header row. The first row should name the columns, with at least a Unit column, as in the template: Unit, Type, Bedrooms, Size (sq ft), Price (AED), Status, Floor, View.";

/** Reads the first sheet that has a header row with a unit column. Throws (with NO_HEADER) when none does. */
export function parseSheets(sheets: Sheet[]): ParsedSheet & { sheet: string | null } {
  for (const sheet of sheets) {
    const parsed = parseSheet(sheet);
    if (parsed) return { ...parsed, sheet: sheet.name };
  }
  throw new Error(NO_HEADER);
}

export function parseSheet(sheet: Sheet): ParsedSheet | null {
  // Price lists often start with a title or a logo row; the header is the first row naming a unit column.
  const headerAt = sheet.rows
    .slice(0, HEADER_SEARCH_ROWS)
    .findIndex((r) => matchColumns(r.cells).columns.some((c) => c.field === "unitNo"));
  if (headerAt < 0) return null;
  const { columns, ignored } = matchColumns(sheet.rows[headerAt].cells);

  const rows: ParsedRow[] = [];
  const errors: ParsedSheet["errors"] = [];
  const firstSeen = new Map<string, number>();
  const body = sheet.rows.slice(headerAt + 1);
  for (const { row, cells } of body) {
    if (rows.length + errors.length >= MAX_IMPORT_ROWS) {
      errors.push({ row, message: `Only the first ${MAX_IMPORT_ROWS.toLocaleString("en-US")} rows are read. Split the file and import the rest separately.` });
      break;
    }
    const result = parseRow(columns, cells);
    if ("skip" in result) continue;
    if ("problems" in result) {
      errors.push({ row, message: result.problems.join(" ") });
      continue;
    }
    const key = result.data.unitNo.toLowerCase();
    const first = firstSeen.get(key);
    if (first !== undefined) {
      errors.push({ row, message: `Unit ${result.data.unitNo} is already on row ${first}. Each unit can appear once.` });
      continue;
    }
    firstSeen.set(key, row);
    rows.push({ row, data: result.data });
  }

  return { columns: columns.map(({ field, header }) => ({ field, header })), ignoredHeaders: ignored, rows, errors };
}

function parseRow(columns: Column[], cells: string[]): { data: ImportRow } | { problems: string[] } | { skip: true } {
  const raw: Record<string, unknown> = {};
  const problems: string[] = [];
  const quote = (text: string) => `“${text}”`;
  let studio = false;

  for (const column of columns) {
    const text = (cells[column.index] ?? "").trim();
    if (!text || text === "-" || text === "—") continue; // blank keeps the current value
    switch (column.field) {
      case "unitNo":
        raw.unitNo = text;
        break;
      case "type": {
        const type = parseType(text);
        if (type) raw.type = type;
        else problems.push(`Type ${quote(text)} isn't apartment, villa, townhouse or penthouse.`);
        if (type && ["studio", "ستوديو", "استوديو"].includes(text.toLowerCase())) studio = true;
        break;
      }
      case "bedrooms": {
        const beds = parseBedrooms(text);
        if (beds === null) problems.push(`Bedrooms ${quote(text)} isn't a number (use 0 or "Studio" for a studio).`);
        else raw.bedrooms = beds;
        break;
      }
      case "sizeSqft": {
        const size = parseAmount(text);
        if (size === null) problems.push(`Size ${quote(text)} isn't a number of square feet.`);
        else raw.sizeSqft = column.sqm ? Math.round(size * SQFT_PER_SQM) : size;
        break;
      }
      case "price": {
        const price = parseAmount(text);
        if (price === null) problems.push(`Price ${quote(text)} isn't an amount in AED.`);
        else raw.price = price;
        break;
      }
      case "status": {
        const status = parseStatus(text);
        if (status) raw.status = status;
        else problems.push(`Status ${quote(text)} isn't available, reserved or sold.`);
        break;
      }
      case "floor":
      case "view":
        raw[column.field] = text;
        break;
    }
  }

  const filled = Object.keys(raw).length + problems.length;
  if (filled === 0) return { skip: true }; // a row with nothing in the matched columns (notes, totals)
  if (!raw.unitNo) return { problems: ["The unit number is missing.", ...problems] };
  if (studio && raw.bedrooms === undefined) raw.bedrooms = 0;
  if (problems.length) return { problems: [`Unit ${raw.unitNo}:`, ...problems] };

  const checked = importRowSchema.safeParse(raw);
  if (!checked.success) {
    return { problems: [`Unit ${raw.unitNo}:`, ...new Set(checked.error.issues.map((issue) => issue.message))] };
  }
  return { data: checked.data as ImportRow };
}

/* ---------- Plan ---------- */

const COMPARED: ImportField[] = ["type", "bedrooms", "sizeSqft", "price", "status", "floor", "view"];
const REQUIRED_FOR_NEW: ImportField[] = ["type", "bedrooms", "price"];

export type ExistingUnit = Pick<UnitFields, "unitNo" | (typeof COMPARED)[number]> & { id: string };

export type ImportPlan = {
  add: { index: number; row: ImportRow }[];
  update: { index: number; id: string; row: ImportRow; changes: ImportField[] }[];
  unchanged: number;
  missing: { index: number; row: ImportRow; fields: ImportField[] }[]; // new units without the required fields
};

/** Splits rows into new units, changed units and unchanged ones. Units are matched on unit number, ignoring case. */
export function planImport(rows: ImportRow[], existing: ExistingUnit[]): ImportPlan {
  const byNo = new Map(existing.map((u) => [u.unitNo.trim().toLowerCase(), u]));
  const plan: ImportPlan = { add: [], update: [], unchanged: 0, missing: [] };
  rows.forEach((row, index) => {
    const current = byNo.get(row.unitNo.trim().toLowerCase());
    if (!current) {
      const fields = REQUIRED_FOR_NEW.filter((f) => row[f] === undefined);
      if (fields.length) plan.missing.push({ index, row, fields });
      else plan.add.push({ index, row });
      return;
    }
    const changes = COMPARED.filter((f) => row[f] !== undefined && row[f] !== current[f]);
    if (changes.length) plan.update.push({ index, id: current.id, row: { ...row, unitNo: current.unitNo }, changes });
    else plan.unchanged++;
  });
  return plan;
}

export function missingMessage(row: ImportRow, fields: ImportField[]) {
  const names = fields.map((f) => IMPORT_FIELD_LABEL[f].replace(/ \(.*\)$/, "").toLowerCase());
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  return `Unit ${row.unitNo} is new, so it needs a ${list}.`;
}

/** The preview shown before an import: what will be added, what will change and which rows can't be used. */
export function buildPreview(fileName: string, sheets: Sheet[], existing: ExistingUnit[]): ImportPreview {
  const parsed = parseSheets(sheets);
  const plan = planImport(
    parsed.rows.map((r) => r.data),
    existing,
  );
  const errors = [
    ...parsed.errors,
    ...plan.missing.map((m) => ({ row: parsed.rows[m.index].row, message: missingMessage(m.row, m.fields) })),
  ].sort((a, b) => a.row - b.row);
  const usable = new Set([...plan.add.map((a) => a.index), ...plan.update.map((u) => u.index)]);
  return {
    fileName,
    sheet: parsed.sheet,
    columns: parsed.columns,
    ignoredHeaders: parsed.ignoredHeaders,
    add: plan.add.map((a) => a.row),
    update: plan.update.map((u) => ({ row: u.row, changes: u.changes })),
    unchanged: plan.unchanged,
    errors,
    rows: parsed.rows.filter((_, i) => usable.has(i)).map((r) => r.data),
  };
}

/* ---------- Template ---------- */

export const TEMPLATE_CSV = [
  "Unit,Type,Bedrooms,Size (sq ft),Price (AED),Status,Floor,View",
  "A-0701,Apartment,1,820,1450000,Available,7,Marina",
  "S-0102,Apartment,Studio,480,950000,Available,1,City",
  "TH-12,Townhouse,3,2400,3600000,Reserved,,Park",
  "",
].join("\r\n");
