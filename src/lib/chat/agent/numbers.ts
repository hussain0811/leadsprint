// Numbers the reply check may accept: everything that appears in the data the agent was given.

const ARABIC_INDIC = /[٠-٩۰-۹]/g;

function westernDigits(text: string): string {
  return text.replace(ARABIC_INDIC, (d) => {
    const code = d.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

const SCALE: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9 };

/**
 * Every number in a text, including "1,250,000", "1.2M", "850k", "2 million" and Arabic-Indic
 * digits. Scaled forms also add the bare figure ("1.2M" gives 1,200,000 and 1.2).
 */
export function extractNumbers(text: string): number[] {
  const out = new Set<number>();
  const normal = westernDigits(text).replace(/٫/g, ".").replace(/٬/g, ",");
  const re = /(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(k|thousand|mn|m|million|bn|b|billion)?(?![a-z])/gi;
  for (const match of normal.matchAll(re)) {
    const value = Number(`${match[1].replace(/,/g, "")}${match[2] ? `.${match[2]}` : ""}`);
    if (!Number.isFinite(value)) continue;
    out.add(value);
    const scale = match[3] ? SCALE[match[3].toLowerCase()] : undefined;
    if (scale) out.add(Math.round(value * scale));
  }
  return [...out];
}

/** All numbers across several texts and plain values, without duplicates. */
export function collectKnownNumbers(texts: string[], values: Array<number | null | undefined> = []): number[] {
  const out = new Set<number>();
  for (const text of texts) for (const n of extractNumbers(text)) out.add(n);
  for (const v of values) if (typeof v === "number" && Number.isFinite(v)) out.add(v);
  return [...out];
}
