// Documents and questions go through the same steps, so a keyword typed one way still matches
// text written another way (case, Arabic diacritics and letter variants, digits).

// Harakat, Quranic marks, superscript alef and tatweel: decoration that doesn't change the word.
const ARABIC_MARKS = /[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۨ-ۭـ]/g;
// Soft hyphens, direction marks, zero-width joiners and BOMs would otherwise split words in two.
const INVISIBLE = /[­؜᠎‌-‏‪-‮⁠-⁤﻿]/g;
const WORD_BREAK = /[^\p{L}\p{M}\p{N}]+/u;

// Longest first, so "وال" is tried before "ال".
const ARABIC_PREFIXES = ["وال", "بال", "كال", "فال", "ال", "لل"];

const ENGLISH_STOPWORDS = `a about above after again against all also am an and any are as at be because been before being
below between both but by can could did do does doing during each else few for from further get got had has have having he
hello her here hers herself hey hi him himself his how i if in into is it its itself just know let like many me more most
much my myself need no nor not now of on once only or other our ours ourselves out over own please same she should so some
such tell than thank thanks that the their theirs them themselves then there these they this those through to too under
until up us very want was we were what when where which while who whom whose why will with would you your yours yourself
yourselves s t d ll m re ve don doesn didn isn aren wasn weren won wouldn couldn shouldn hasn haven`;

// Includes the question words and courtesies leads type in Gulf Arabic, which never help find a passage.
const ARABIC_STOPWORDS = `في من الى إلى على عن مع و او أو ثم هل ما ماذا لماذا ليش كيف كم متى اين أين وين وش ايش شنو هذا هذه
ذلك تلك هؤلاء هناك هنا هو هي هم هن انا أنا انت أنت انتم أنتم نحن قد لا لم لن ليس ان أن إن كان كانت يكون تكون التي الذي الذين
كل بعض غير عند عندك عندكم لدى لديكم حتى اذا إذا لو بين كما لكن ايضا أيضا اي أي يا بعد قبل فقط جدا الان الآن به بها له لها لهم
فيه فيها منه منها عليه عليها ممكن ابي أبي ابغى أبغى مرحبا السلام عليكم شكرا سمحت`;

/** Normalises English and Arabic text for keyword matching (case, diacritics, letter variants, digits). */
export function normalizeText(text: string): string {
  return (
    text
      .normalize("NFKC")
      .toLowerCase()
      .replace(INVISIBLE, "")
      .replace(/​/g, " ")
      .replace(ARABIC_MARKS, "")
      .replace(/[آأإٱ]/g, "ا") // آ أ إ ٱ → ا
      .replace(/[ىی]/g, "ي") // ى and Persian ی → ي
      .replace(/ک/g, "ك") // Persian ک → ك
      .replace(/ة/g, "ه") // ة → ه
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
      .replace(/٫/g, ".") // Arabic decimal separator
      .replace(/٬/g, ",") // Arabic thousands separator
      // "1,500,000" and "1500000" are the same price.
      .replace(/(\d),(?=\d{3}(?!\d))/g, "$1")
  );
}

const STOPWORDS = new Set(`${ENGLISH_STOPWORDS} ${ARABIC_STOPWORDS}`.split(/\s+/).filter(Boolean).map(normalizeText));

/** Normalised search tokens with stopwords removed and light prefix/plural stripping. */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const word of normalizeText(text).split(WORD_BREAK)) {
    if (!word || STOPWORDS.has(word)) continue;
    const stem = stripAffixes(word);
    if (!STOPWORDS.has(stem)) tokens.push(stem);
  }
  return tokens;
}

function stripAffixes(word: string): string {
  if (/^[a-z]+$/.test(word)) return stripPlural(word);
  for (const prefix of ARABIC_PREFIXES) {
    // Keep at least two letters, so short words that merely start with these letters survive.
    if (word.startsWith(prefix) && word.length - prefix.length >= 2) return word.slice(prefix.length);
  }
  return word;
}

// Harman's "S" stemmer: plurals only, so "prices" meets "price" but "status" and "address" stay whole.
function stripPlural(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ies") && !/[ae]ies$/.test(word)) return `${word.slice(0, -3)}y`;
  if (word.endsWith("es") && !/[aeo]es$/.test(word)) return word.slice(0, -1);
  if (word.endsWith("s") && !/[us]s$/.test(word)) return word.slice(0, -1);
  return word;
}
