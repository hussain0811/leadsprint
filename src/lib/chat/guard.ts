import type { FreeCheckResult, Localized, OrgSettings, ReplyCheckResult } from "./types";

/* ---------- Text and number normalisation (shared with the flow engine) ---------- */

/** Turns Arabic-Indic and Persian digits into 0-9, and Arabic decimal/thousands marks into "." and ",". */
export function toWesternDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, ".")
    .replace(/٬/g, ",");
}

// Zero-width and direction marks (Unicode Cf) that could hide a phrase.
const FORMAT_CHARS = new RegExp("\\p{Cf}", "gu");

/**
 * Lower-cases, strips zero-width characters, uses Western digits and folds common Arabic spelling variants
 * (hamza forms of alef, taa marbuta, alef maqsura, diacritics, tatweel) so typed answers compare reliably.
 */
export function normalizeForMatch(text: string): string {
  return toWesternDigits(text.replace(FORMAT_CHARS, ""))
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, "") // diacritics and tatweel
    .replace(/[أإآٱ]/g, "ا") // أ إ آ ٱ -> ا
    .replace(/ى/g, "ي") // ى -> ي
    .replace(/ة/g, "ه") // ة -> ه
    .replace(/ؤ/g, "و") // ؤ -> و
    .replace(/ئ/g, "ي") // ئ -> ي
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export type Amount = {
  value: number;
  step: number; // precision the number was written with, e.g. 100000 for "1.2M"
  raw: string;
  index: number;
  unit: boolean; // had k / M / million / ألف / مليون
  currency: boolean; // AED, Dhs or درهم next to it
  percent: boolean;
  identifier: boolean; // part of a code like "A-0703", "Q4", "DEMO-PERMIT-0001"
};

const MULTIPLIERS: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  "الف": 1e3, // الف
  "الاف": 1e3, // الاف
  m: 1e6,
  mn: 1e6,
  million: 1e6,
  millions: 1e6,
  "مليون": 1e6, // مليون
  "ملايين": 1e6, // ملايين
  bn: 1e9,
  billion: 1e9,
  "مليار": 1e9, // مليار
};

const AR_LETTER = "؀-ۿ";
const NUMBER_RE = new RegExp(
  "(\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.(\\d+))?" +
    "(?:(k|mn|m|bn)(?![a-z0-9])|\\s?(mn)(?![a-z0-9])|\\s*(thousand|millions|million|billion|الاف|الف|ملايين|مليون|مليار)(?![a-z0-9" +
    AR_LETTER +
    "]))?",
  "g",
);
const CURRENCY_BEFORE = /(aed|dhs?|درهم)\s*$/;
const CURRENCY_AFTER = /^\s*(aed|dhs?\b|درهم)/;
const PERCENT_AFTER = /^\s*(%|٪|percent|per cent|بالمئه|بالمائه|في المئه)/;
const RANGE_JOIN = /^\s*(-|–|to|and|or|و|الي|لي|او)\s*$/;

const EN_WORD_NUMBERS: Record<string, number> = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/**
 * Finds amounts in text: "1.2M", "1,200,000", "AED 950k", "٢ مليون", "مليون ونص", "half a million".
 * Works on normalizeForMatch output internally; `index` and `raw` refer to that normalised text.
 */
export function extractAmounts(text: string): Amount[] {
  const t = normalizeForMatch(text);
  const out: Amount[] = [];

  for (const m of t.matchAll(NUMBER_RE)) {
    const [raw, intPart, dec, shortUnit, spacedMn, wordUnit] = m;
    const index = m.index ?? 0;
    const unitWord = shortUnit ?? spacedMn ?? wordUnit;
    const mult = unitWord ? MULTIPLIERS[unitWord] ?? 1 : 1;
    const decimals = dec ? dec.length : 0;
    const base = parseFloat(intPart.replace(/,/g, "") + (dec ? "." + dec : ""));
    const before = t.slice(Math.max(0, index - 12), index);
    const after = t.slice(index + raw.length, index + raw.length + 14);
    const prevWord = /([a-z]+)-?$/.exec(before)?.[1];
    const identifier = !!prevWord && !/^(aed|dhs?|usd)$/.test(prevWord);
    out.push({
      value: base * mult,
      step: mult / Math.pow(10, decimals),
      raw: raw.trim(),
      index,
      unit: !!unitWord,
      currency: CURRENCY_BEFORE.test(before) || CURRENCY_AFTER.test(after),
      percent: PERCENT_AFTER.test(after),
      identifier,
    });
  }

  // "1-2M", "between 1 and 2 million": the first number takes the second one's unit.
  for (let i = out.length - 2; i >= 0; i--) {
    const a = out[i];
    const b = out[i + 1];
    if (a.unit || !b.unit) continue;
    const between = t.slice(a.index + a.raw.length, b.index);
    if (!RANGE_JOIN.test(between)) continue;
    const mult = b.value / parseFloat(b.raw.replace(/[^\d.]/g, "") || "1");
    if (!Number.isFinite(mult) || mult <= 1) continue;
    a.value *= mult;
    a.step *= mult;
    a.unit = true;
  }

  // Number words: مليون / مليونين / نص مليون / مليون ونص, "a million", "half a million", "two million".
  const halfAfter = "(?:\\s*و\\s*(?:نص|نصف))?"; // ونص / ونصف
  const wordRe = new RegExp(
    "(نص|نصف)?\\s*(مليونين|مليون)" + halfAfter + // [نص] مليون|مليونين [ونص]
      "|(half a|a|one|two|three|four|five|six|seven|eight|nine|ten) million(?: and a half)?",
    "g",
  );
  for (const m of t.matchAll(wordRe)) {
    const index = m.index ?? 0;
    // Skip when a digit directly precedes: "2 مليون" was handled above.
    if (/\d[\s,.]*$/.test(t.slice(0, index))) continue;
    const raw = m[0].trim();
    let value: number;
    if (m[2]) {
      value = m[2].endsWith("ين") ? 2e6 : 1e6; // مليونين
      if (m[1]) value = 0.5e6;
      else if (/و\s*نص/.test(raw)) value += 0.5e6;
    } else {
      value = m[3] === "half a" ? 0.5e6 : (EN_WORD_NUMBERS[m[3]] ?? 1) * 1e6;
      if (raw.endsWith("and a half")) value += 0.5e6;
    }
    out.push({ value, step: 0.5e6, raw, index, unit: true, currency: false, percent: false, identifier: false });
  }

  return out.sort((a, b) => a.index - b.index);
}

/* ---------- Free checks on inbound messages ---------- */

const CODE_PATTERNS = [
  /```/,
  /<\/?\s*(script|iframe|style|html|body|svg)\b/i,
  /<\?php/i,
  /\bfunction\s*\w*\s*\([^)]*\)\s*\{/i,
  /=>\s*\{/,
  /\bconsole\.log\s*\(/i,
  /^\s*import\s+[\w{}*,\s]+\s+from\s+['"]/im,
  /^\s*#include\s*</im,
  /^\s*def\s+\w+\s*\(.*\)\s*:/im,
  /\bpublic\s+static\s+void\b/i,
];

const INJECTION_PATTERNS = [
  // "ignore all previous instructions", "disregard your rules"; not "forget the rules about service charge".
  /\b(ignore|disregard|forget|override|bypass)\s+(all\s+|any\s+|of\s+|the\s+|your\s+|these\s+|those\s+)*(previous|prior|above|earlier|preceding|system|original|initial|your)\s+(rules|instructions?|prompts?|guidelines|directions)\b/,
  /\b(ignore|disregard|forget|override|bypass)\s+(all\s+|any\s+|the\s+|your\s+)*(instructions?|prompts?|system message|programming)\b/,
  /\b(system|developer|hidden)\s+(prompt|message|instructions?)\b/,
  // Role-play only: "you are now a pirate", "you are now DAN"; not "you are now my agent?".
  /\byou\s+are\s+now\s+(a|an|dan|in\s+\w+\s+mode|unrestricted|unfiltered|jailbroken|free\s+from|no\s+longer|playing|pretending|my\s+(new\s+)?(ai|assistant|character|persona|girlfriend|boyfriend))\b/,
  /\bpretend\s+(to\s+be|you\s*('re|are))\b/,
  /\brole[\s-]?play/,
  /\bjail\s?break/,
  /\bdeveloper\s+mode\b/,
  /\bdo\s+anything\s+now\b/,
  // "answer without restrictions"; not "are there no restrictions on holiday rentals?".
  /\b(answer|respond|reply|talk|speak|act|chat)\b.{0,20}\b(without|with no)\s+(restrictions|filters|censorship|limits)\b/,
  // Arabic (normalised): تجاهل/انسى التعليمات أو الأوامر، تقمص/العب دور (not "مثل دور": دور is also a floor), موجه النظام
  /(^|\s)(تجاهل|انس|انسي|الغي?)\s.{0,30}(التعليمات|الاوامر)/,
  /(تقمص|العب)\s+دور/,
  /(موجه|تعليمات)\s+النظام/,
];

const REPLIES = {
  tooLong: (n: number): Localized => ({
    en: `Thanks! Please keep your message short (under ${n} characters) so I can help.`,
    ar: `شكرًا لك! ممكن تختصر رسالتك (أقل من ${n} حرف) عشان أقدر أساعدك؟`,
  }),
  rate: {
    en: "You're sending messages quickly. Please give me a moment and I'll reply.",
    ar: "وصلتني رسائل كثيرة بسرعة. لحظة من فضلك وبرد عليك.",
  },
  abuse: {
    en: "I can only help with questions about our properties, viewings and prices.",
    ar: "أقدر أساعدك بس في الأسئلة عن عقاراتنا والمعاينات والأسعار.",
  },
} satisfies Record<string, Localized | ((n: number) => Localized)>;

/** Checks that cost nothing and run before any AI call: length, rate, obvious misuse patterns, blocked leads. */
// `tap`: the message is a button or list tap. Taps never hit the rate limit, and callers should
// leave taps out of `recentInboundAt` too (typed messages only).
export function freeChecks(text: string, ctx: { settings: OrgSettings; recentInboundAt: Date[]; blocked: boolean; now?: Date; tap?: boolean }): FreeCheckResult {
  const { settings } = ctx;
  if (ctx.blocked) return { ok: false, reason: "blocked", strike: false, reply: null };

  // recentInboundAt: the lead's earlier messages; at the limit within the last minute means wait.
  const now = (ctx.now ?? new Date()).getTime();
  const lastMinute = ctx.recentInboundAt.filter((d) => now - d.getTime() < 60_000 && d.getTime() <= now).length;
  if (!ctx.tap && lastMinute >= settings.leadMessagesPerMinute) return { ok: false, reason: "rate_limited", strike: false, reply: REPLIES.rate };

  // A huge paste (3x the limit) is a strike; an ordinary long message is only asked to be shorter.
  if (text.length > settings.maxMessageChars) {
    return { ok: false, reason: "too_long", strike: text.length > settings.maxMessageChars * 3, reply: REPLIES.tooLong(settings.maxMessageChars) };
  }

  const norm = normalizeForMatch(text);
  if (CODE_PATTERNS.some((re) => re.test(text)) || INJECTION_PATTERNS.some((re) => re.test(norm))) {
    return { ok: false, reason: "abuse_pattern", strike: true, reply: REPLIES.abuse };
  }
  return { ok: true };
}

/* ---------- Reply check on AI output ---------- */

const REPLY_CODE_PATTERNS = [/```/, /<\/?\s*(script|iframe|style)\b/i, /<\?php/i, /\bfunction\s*\w*\s*\([^)]*\)\s*\{/i, /=>\s*\{/, /\bconsole\.log\s*\(/i, /^\s*import\s+[\w{}*,\s]+\s+from\s+['"]/im];

const TLDS =
  "com|net|org|ae|io|co|info|biz|me|app|dev|ly|gl|link|xyz|online|site|ai|uk|us|ru|in|sa|qa|om|bh|kw|eg|tv|gg|to|cc|realestate|properties|property|homes|estate|example";
const URL_RE = /\bhttps?:\/\/[^\s<>"'()]+/gi;
const DOMAIN_RE = new RegExp(`\\b(?:www\\.)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:${TLDS})(?![a-z0-9-])(?:[/:][^\\s<>"'()]*)?`, "gi");
const PHONE_RE = /(?:\+|00)?\d(?:[ \-()]{0,2}\d){6,14}/g;

function hostOf(link: string): string {
  const withScheme = /^https?:\/\//i.test(link) ? link : `http://${link}`;
  try {
    return new URL(withScheme).hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  } catch {
    return link.toLowerCase();
  }
}

function domainAllowed(host: string, allowed: string[]): boolean {
  return allowed.some((d) => {
    const dom = d.toLowerCase().replace(/^www\./, "");
    return host === dom || host.endsWith(`.${dom}`);
  });
}

function phoneKey(phone: string): string {
  return phone.replace(/\D/g, "").slice(-9);
}

function looksLikePhone(candidate: string): boolean {
  const digits = candidate.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return false;
  if (/^(\+|00)/.test(candidate) || /^(0|971|800)/.test(digits)) return true;
  return /[ \-()]/.test(candidate) && digits.length >= 9;
}

function knownMatch(a: Amount, known: number[]): boolean {
  return known.some((k) => {
    const diff = Math.abs(a.value - k);
    if (diff < 1e-6) return true;
    // A rounded spelling of a real number ("1.5M" for 1,520,000) is fine; a different price is not.
    return diff <= a.step / 2 + 1e-6 && diff <= Math.abs(k) * 0.05;
  });
}

/** Checks an AI reply before it's sent: length, code, links and phone numbers not allowed, prices not in the data. */
export function checkReply(reply: string, ctx: { settings: OrgSettings; knownNumbers: number[] }): ReplyCheckResult {
  const { settings } = ctx;
  if (reply.length > settings.maxReplyChars) return { ok: false, reason: `Reply is too long (${reply.length} characters, limit ${settings.maxReplyChars})` };
  if (REPLY_CODE_PATTERNS.some((re) => re.test(reply))) return { ok: false, reason: "Reply contains code" };

  let text = toWesternDigits(reply);

  // Links: full URLs and bare domains must be on the org's own sites.
  for (const re of [URL_RE, DOMAIN_RE]) {
    for (const m of text.matchAll(re)) {
      const host = hostOf(m[0]);
      if (!domainAllowed(host, settings.allowedLinkDomains)) return { ok: false, reason: `Link not allowed: ${host}` };
    }
    text = text.replace(re, " ");
  }

  // Phone numbers: only the org's own.
  const allowedPhones = settings.allowedPhones.map((p) => phoneKey(toWesternDigits(p)));
  for (const m of text.matchAll(PHONE_RE)) {
    const candidate = m[0].trim();
    if (!looksLikePhone(candidate)) continue;
    if (!allowedPhones.includes(phoneKey(candidate))) return { ok: false, reason: `Phone number not allowed: ${candidate}` };
    text = text.replace(candidate, " ");
  }

  // Prices and other figures: only numbers from the units table or the passages used.
  for (const a of extractAmounts(text)) {
    if (a.identifier || a.percent) continue;
    if (!a.unit && a.value <= 100) continue; // bedrooms, floors, percentages, small counts
    if (!a.unit && !a.currency && Number.isInteger(a.value) && a.value >= 1900 && a.value <= 2100 && !a.raw.includes(",")) continue; // years
    if (!knownMatch(a, ctx.knownNumbers)) return { ok: false, reason: `Number not in the data: ${a.raw}` };
  }
  return { ok: true };
}

/** The free fixed reply for off-topic messages, steering back to property. */
export function offTopicReply(projectName: string | null): Localized {
  return {
    en: `I can only help with ${projectName ?? "our properties"}. Would you like to know about the homes, prices or booking a viewing?`,
    ar: `أقدر أساعدك بس بخصوص ${projectName ?? "عقاراتنا"}. تبي تعرف عن الوحدات أو الأسعار أو تحجز معاينة؟`,
  };
}
