import { extractAmounts, normalizeForMatch } from "./guard";
import { WA_LIMITS } from "./types";
import type { FlowDefinition, FlowResult, FlowState, FlowStep, InboundInput, Lang, Localized, OutgoingMessage, Qualification, ReplyOption } from "./types";

/**
 * Engine conventions (also checked by validateFlow):
 * - A `next` of "done" (or no `next`) ends the flow.
 * - Texts may use {org} and {project}.
 * - Budget options use a "min-max" string in AED, e.g. "1000000-2000000", "0-1000000" or "5000000-";
 *   the answer fills budgetMin and budgetMax.
 * - The "booking" step lists the next free slots from FlowContext (up to 9 rows) before its own options;
 *   it's skipped when there are no free slots.
 * - Steps whose field is already known (e.g. collected by the AI before a fallback) are skipped.
 */
export const FLOW_END = "done";

/* ---------- The ready-made flow ---------- */

const loc = (en: string, ar: string): Localized => ({ en, ar });

/** The ready-made English/Arabic qualification flow used when an org has none saved. */
export const DEFAULT_FLOW: FlowDefinition = {
  greeting: loc(
    "Hi! I'm the automated assistant for {org}. I'll ask a few quick questions about {project} so the right person can help you.",
    "حياك الله! أنا المساعد الآلي لـ{org}. بسألك كم سؤال سريع عن {project} عشان نوصلك بالشخص المناسب.",
  ),
  start: "language",
  steps: [
    {
      id: "language",
      field: "language",
      ask: loc("Which language do you prefer?\nأي لغة تفضل؟", "Which language do you prefer?\nأي لغة تفضل؟"),
      style: "buttons",
      options: [
        { id: "en", title: loc("English", "English"), value: "en" },
        { id: "ar", title: loc("العربية", "العربية"), value: "ar" },
      ],
      next: "intent",
    },
    {
      id: "intent",
      field: "intent",
      ask: loc("Are you looking to buy or rent?", "تدوّر تشتري ولا تستأجر؟"),
      style: "buttons",
      options: [
        { id: "buy", title: loc("Buy", "شراء"), value: "buy" },
        { id: "rent", title: loc("Rent", "إيجار"), value: "rent" },
        { id: "browsing", title: loc("Just browsing", "أتفرج بس"), value: "browsing", next: FLOW_END },
      ],
      next: "purpose",
    },
    {
      id: "purpose",
      field: "purpose",
      when: { field: "intent", equals: "buy" },
      ask: loc("Is it a home to live in or an investment?", "للسكن ولا للاستثمار؟"),
      style: "buttons",
      options: [
        { id: "live", title: loc("To live in", "للسكن"), value: "live" },
        { id: "invest", title: loc("Investment", "للاستثمار"), value: "invest" },
      ],
      next: "budget_buy",
    },
    {
      id: "budget_buy",
      field: "budgetMax",
      when: { field: "intent", equals: "buy" },
      ask: loc("What's your budget?", "كم ميزانيتك تقريبًا؟"),
      style: "list",
      options: [
        { id: "b1", title: loc("Under AED 1M", "أقل من مليون درهم"), value: "0-1000000" },
        { id: "b2", title: loc("AED 1M - 2M", "1 - 2 مليون درهم"), value: "1000000-2000000" },
        { id: "b3", title: loc("AED 2M - 3M", "2 - 3 مليون درهم"), value: "2000000-3000000" },
        { id: "b4", title: loc("AED 3M - 5M", "3 - 5 مليون درهم"), value: "3000000-5000000" },
        { id: "b5", title: loc("Above AED 5M", "أكثر من 5 مليون درهم"), value: "5000000-" },
      ],
      next: "budget_rent",
    },
    {
      id: "budget_rent",
      field: "budgetMax",
      when: { field: "intent", equals: "rent" },
      ask: loc("What's your yearly rent budget?", "كم ميزانيتك للإيجار السنوي؟"),
      style: "list",
      options: [
        { id: "r1", title: loc("Under AED 60K a year", "أقل من 60 ألف بالسنة"), value: "0-60000" },
        { id: "r2", title: loc("AED 60K - 100K a year", "60 - 100 ألف بالسنة"), value: "60000-100000" },
        { id: "r3", title: loc("AED 100K - 150K a year", "100 - 150 ألف بالسنة"), value: "100000-150000" },
        { id: "r4", title: loc("AED 150K - 250K a year", "150 - 250 ألف بالسنة"), value: "150000-250000" },
        { id: "r5", title: loc("Above AED 250K a year", "أكثر من 250 ألف بالسنة"), value: "250000-" },
      ],
      next: "type",
    },
    {
      id: "type",
      field: "propertyType",
      ask: loc("What type of property are you after?", "وش نوع العقار اللي تبيه؟"),
      style: "list",
      options: [
        { id: "apartment", title: loc("Apartment", "شقة"), value: "apartment" },
        { id: "villa", title: loc("Villa", "فيلا"), value: "villa" },
        { id: "townhouse", title: loc("Townhouse", "تاون هاوس"), value: "townhouse" },
        { id: "penthouse", title: loc("Penthouse", "بنتهاوس"), value: "penthouse" },
        { id: "any", title: loc("Open to anything", "ما يفرق معي"), value: "any" },
      ],
      next: "bedrooms",
    },
    {
      id: "bedrooms",
      field: "bedrooms",
      ask: loc("How many bedrooms do you need?", "كم غرفة نوم تحتاج؟"),
      style: "list",
      options: [
        { id: "br0", title: loc("Studio", "استوديو"), value: 0 },
        { id: "br1", title: loc("1 bedroom", "غرفة وحدة"), value: 1 },
        { id: "br2", title: loc("2 bedrooms", "غرفتين"), value: 2 },
        { id: "br3", title: loc("3 bedrooms", "3 غرف"), value: 3 },
        { id: "br4", title: loc("4+ bedrooms", "4 غرف أو أكثر"), value: 4 },
      ],
      next: "payment",
    },
    {
      id: "payment",
      field: "payment",
      when: { field: "intent", equals: "buy" },
      ask: loc("Will you pay cash or use a mortgage?", "بتدفع كاش ولا عن طريق تمويل بنكي؟"),
      style: "buttons",
      options: [
        { id: "cash", title: loc("Cash", "كاش"), value: "cash" },
        { id: "mortgage", title: loc("Mortgage", "تمويل بنكي"), value: "mortgage" },
      ],
      next: "timeline",
    },
    {
      id: "timeline",
      field: "timeline",
      ask: loc("When are you planning to go ahead?", "متى ناوي تاخذ الخطوة؟"),
      style: "buttons",
      options: [
        { id: "now", title: loc("This month", "هذا الشهر"), value: "now" },
        { id: "1-3m", title: loc("In 1-3 months", "خلال 1-3 شهور"), value: "1-3m" },
        { id: "later", title: loc("Later", "بعدين"), value: "later" },
      ],
      next: "booking",
    },
    {
      id: "booking",
      field: "booking",
      ask: loc(
        "Would you like to book a viewing? Pick a time, or we can call you instead.",
        "تحب تحجز موعد معاينة؟ اختر الوقت اللي يناسبك، أو نتصل فيك بدالها.",
      ),
      style: "list",
      options: [{ id: "call", title: loc("Call me instead", "اتصلوا فيني بدالها"), value: "call" }],
      next: FLOW_END,
    },
  ],
  done: loc("Thanks! Our team at {org} will be in touch with you shortly.", "شكرًا لك! فريق {org} بيتواصل معك قريب."),
  handoff: loc(
    "Thanks for your patience. I'm passing you to someone from our team who will reply shortly.",
    "شكرًا على صبرك. بحوّلك لأحد من فريقنا وبيرد عليك قريب.",
  ),
};

// Fixed engine texts that aren't part of an editable flow.
const TEXT = {
  project: loc("our properties", "عقاراتنا"),
  retry: loc("Sorry, I didn't catch that. Please choose one of the options.", "المعذرة، ما فهمت عليك. اختر وحدة من الخيارات لو سمحت."),
  choose: loc("Choose", "اختر"),
  pickTime: loc("Pick a time", "اختر الوقت"),
  booked: loc("Great, you're down for {time}. The team will confirm it with you.", "تمام، سجلنا لك موعد {time}. الفريق بيأكد لك الموعد."),
  callBack: loc("Sure, someone from our team will call you.", "أكيد، أحد من فريقنا بيتصل فيك."),
  callNote: "Asked for a call instead of a viewing",
};

/* ---------- Validation ---------- */

const QUAL_FIELDS = ["intent", "purpose", "budgetMin", "budgetMax", "propertyType", "bedrooms", "payment", "timeline", "area", "notes"] as const;
const STEP_FIELDS: readonly string[] = [...QUAL_FIELDS, "language", "booking"];
const FIELD_VALUES: Record<string, readonly string[]> = {
  language: ["en", "ar"],
  intent: ["buy", "rent", "browsing"],
  purpose: ["live", "invest"],
  propertyType: ["apartment", "villa", "townhouse", "penthouse", "any"],
  payment: ["cash", "mortgage"],
  timeline: ["now", "1-3m", "later"],
};
const FREE_TEXT_FIELDS = ["area", "notes", "budgetMin", "budgetMax", "bedrooms"];
const BUDGET_RANGE = /^(\d+)-(\d*)$/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function checkLocalized(v: unknown, label: string, max: number, problems: string[]) {
  if (!isRecord(v) || typeof v.en !== "string" || typeof v.ar !== "string") {
    problems.push(`${label} needs English and Arabic text.`);
    return;
  }
  for (const lang of ["en", "ar"] as const) {
    const s = (v[lang] as string).trim();
    const name = lang === "en" ? "English" : "Arabic";
    if (!s) problems.push(`${label} (${name}) is empty.`);
    else if (s.length > max) problems.push(`${label} (${name}) is ${s.length} characters; WhatsApp allows ${max}.`);
  }
}

/** Checks a flow an admin edited; returns plain problems, empty when valid (WhatsApp limits included). */
export function validateFlow(def: unknown): string[] {
  const problems: string[] = [];
  if (!isRecord(def)) return ["The flow must be an object with greeting, start, steps, done and handoff."];

  checkLocalized(def.greeting, "Greeting", WA_LIMITS.body, problems);
  checkLocalized(def.done, "Closing message", WA_LIMITS.body, problems);
  checkLocalized(def.handoff, "Hand-off message", WA_LIMITS.body, problems);
  if (isRecord(def.greeting)) {
    const en = normalizeForMatch(String(def.greeting.en ?? ""));
    const ar = normalizeForMatch(String(def.greeting.ar ?? ""));
    if (en && !/\b(automated|bot|virtual assistant|ai assistant)\b/.test(en)) problems.push("The English greeting must say it's an automated assistant.");
    if (ar && !/(الي|بوت|افتراضي|مساعد ذكي)/.test(ar)) problems.push("The Arabic greeting must say it's an automated assistant (for example \"المساعد الآلي\").");
  }

  if (!Array.isArray(def.steps) || def.steps.length === 0) {
    problems.push("The flow needs at least one step.");
    return problems;
  }
  if (def.steps.length > 30) problems.push("The flow has more than 30 steps.");

  const ids = new Set<string>();
  const edges = new Map<string, string[]>();
  for (const [i, raw] of def.steps.entries()) {
    const label = `Step ${i + 1}`;
    if (!isRecord(raw)) {
      problems.push(`${label} is not a valid step.`);
      continue;
    }
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const name = id ? `Step "${id}"` : label;
    if (!id) problems.push(`${label} needs an id.`);
    else if (id === FLOW_END) problems.push(`${label} can't use the id "${FLOW_END}"; it means the end of the flow.`);
    else if (ids.has(id)) problems.push(`${name} is used twice.`);
    ids.add(id);

    const field = raw.field;
    if (field !== null && (typeof field !== "string" || !STEP_FIELDS.includes(field))) problems.push(`${name} saves to an unknown field.`);
    const style = raw.style;
    if (style !== "buttons" && style !== "list" && style !== "text") problems.push(`${name} must be buttons, list or text.`);
    checkLocalized(raw.ask, `${name} question`, WA_LIMITS.body, problems);

    const options = Array.isArray(raw.options) ? raw.options : null;
    if (!options) {
      problems.push(`${name} needs an options list (it can be empty for text steps).`);
      continue;
    }
    if (style === "buttons") {
      if (options.length === 0) problems.push(`${name} has no buttons.`);
      if (options.length > WA_LIMITS.buttons) problems.push(`${name} has ${options.length} buttons; WhatsApp allows ${WA_LIMITS.buttons}.`);
    }
    if (style === "list") {
      if (options.length === 0 && field !== "booking") problems.push(`${name} has no list rows.`);
      if (options.length > WA_LIMITS.listRows) problems.push(`${name} has ${options.length} rows; WhatsApp allows ${WA_LIMITS.listRows}.`);
    }
    if (style === "text" && options.length === 0 && typeof field === "string" && field !== "language" && !FREE_TEXT_FIELDS.includes(field)) {
      problems.push(`${name} needs options to fill "${field}".`);
    }
    if (field === "booking") {
      if (style !== "list") problems.push(`${name} must be a list so it can show the free times.`);
      if (options.length > 3) problems.push(`${name} can have at most 3 extra rows, to leave room for the free times.`);
    }

    const titleMax = style === "buttons" ? WA_LIMITS.buttonTitle : WA_LIMITS.rowTitle;
    const optionIds = new Set<string>();
    const targets: string[] = [];
    for (const [j, opt] of options.entries()) {
      const oname = `${name}, option ${j + 1}`;
      if (!isRecord(opt)) {
        problems.push(`${oname} is not valid.`);
        continue;
      }
      const oid = typeof opt.id === "string" ? opt.id.trim() : "";
      if (!oid) problems.push(`${oname} needs an id.`);
      else if (optionIds.has(oid)) problems.push(`${oname} repeats the id "${oid}".`);
      else if (field === "booking" && oid.startsWith("slot:")) problems.push(`${oname} can't use an id starting with "slot:".`);
      optionIds.add(oid);
      checkLocalized(opt.title, `${oname} title`, style === "text" ? WA_LIMITS.body : titleMax, problems);

      const value = opt.value;
      if (value !== null && typeof value !== "string" && typeof value !== "number") problems.push(`${oname} has an invalid value.`);
      else if (typeof field === "string" && value !== null) {
        const allowed = FIELD_VALUES[field];
        if (allowed && !allowed.includes(String(value))) problems.push(`${oname}: "${value}" isn't a valid ${field} (use ${allowed.join(", ")}).`);
        if (field === "bedrooms" && (typeof value !== "number" || value < 0 || !Number.isInteger(value))) problems.push(`${oname}: bedrooms must be a whole number (0 for studio).`);
        if ((field === "budgetMin" || field === "budgetMax") && typeof value === "string" && !BUDGET_RANGE.test(value)) {
          problems.push(`${oname}: budget must be a number or a range like "1000000-2000000".`);
        }
      }
      if (opt.next !== undefined) {
        if (typeof opt.next !== "string") problems.push(`${oname} has an invalid next step.`);
        else targets.push(opt.next);
      }
    }

    if (raw.next !== undefined) {
      if (typeof raw.next !== "string") problems.push(`${name} has an invalid next step.`);
      else targets.push(raw.next);
    }
    if (raw.when !== undefined) {
      const w = raw.when;
      if (!isRecord(w) || typeof w.field !== "string" || !(QUAL_FIELDS as readonly string[]).includes(w.field) || (typeof w.equals !== "string" && typeof w.equals !== "number")) {
        problems.push(`${name} has an invalid condition.`);
      }
    }
    if (id) edges.set(id, targets);
  }

  for (const [from, targets] of edges) {
    for (const to of targets) if (to !== FLOW_END && !ids.has(to)) problems.push(`Step "${from}" goes to "${to}", which doesn't exist.`);
  }
  if (typeof def.start !== "string" || !ids.has(def.start)) problems.push("The first step must be one of the steps.");

  // Loops would ask the same questions forever.
  const state = new Map<string, 1 | 2>();
  let loop: string | null = null;
  const visit = (id: string) => {
    if (loop) return;
    state.set(id, 1);
    for (const to of edges.get(id) ?? []) {
      if (!edges.has(to)) continue;
      if (state.get(to) === 1) loop = to;
      else if (!state.has(to)) visit(to);
    }
    state.set(id, 2);
  };
  for (const id of edges.keys()) if (!state.has(id)) visit(id);
  if (loop) problems.push(`The flow loops back to step "${loop}".`);

  return problems;
}

/* ---------- Running the flow ---------- */

// Facts the flow needs from the database, passed in so the engine stays pure.
export type FlowContext = {
  qualification: Qualification;
  orgName: string;
  projectName: string | null;
  slots: Array<{ id: string; startsAt: string; kind: string }>; // next free slots, soonest first
};

type Choice = { id: string; title: string; titles: string[]; description?: string; value: string | number | null; next?: string; slotId?: string };

const pick = (l: Localized, lang: Lang) => (l[lang] || l.en || l.ar || "").trim();
const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);

function fill(text: string, ctx: FlowContext, lang: Lang): string {
  return text.replaceAll("{org}", ctx.orgName).replaceAll("{project}", ctx.projectName ?? pick(TEXT.project, lang));
}

/* Slot titles in Dubai time (UTC+4, no daylight saving). */
const EN_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const AR_DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const KINDS: Record<string, Localized> = { viewing: loc("Viewing", "معاينة"), call: loc("Call", "مكالمة"), video: loc("Video call", "مكالمة فيديو") };

export function formatSlot(iso: string, lang: Lang): string {
  const d = new Date(new Date(iso).getTime() + 4 * 3600_000);
  if (Number.isNaN(d.getTime())) return iso;
  const h24 = d.getUTCHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  if (lang === "ar") return `${AR_DAYS[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}، ${h12}:${mm} ${h24 < 12 ? "ص" : "م"}`;
  return `${EN_DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${EN_MONTHS[d.getUTCMonth()]}, ${h12}:${mm} ${h24 < 12 ? "am" : "pm"}`;
}

function choicesFor(step: FlowStep, lang: Lang, ctx: FlowContext): Choice[] {
  const own: Choice[] = step.options.map((o) => ({ id: o.id, title: pick(o.title, lang), titles: [o.title.en, o.title.ar], value: o.value, next: o.next }));
  if (step.field !== "booking") return own;
  const room = Math.max(0, Math.min(9, WA_LIMITS.listRows - own.length));
  const slots: Choice[] = ctx.slots.slice(0, room).map((s) => {
    const kind = KINDS[s.kind];
    return {
      id: `slot:${s.id}`,
      title: formatSlot(s.startsAt, lang),
      titles: [formatSlot(s.startsAt, "en"), formatSlot(s.startsAt, "ar")],
      description: kind ? pick(kind, lang) : s.kind,
      value: s.id,
      slotId: s.id,
    };
  });
  return [...slots, ...own];
}

function stepMessage(step: FlowStep, lang: Lang, ctx: FlowContext): OutgoingMessage {
  const body = clip(fill(pick(step.ask, lang), ctx, lang), WA_LIMITS.body);
  const choices = choicesFor(step, lang, ctx);
  if (choices.length === 0) return { kind: "text", body };
  if (step.style === "buttons" && choices.length <= WA_LIMITS.buttons) {
    return { kind: "buttons", body, buttons: choices.map((c) => ({ id: c.id, title: clip(c.title, WA_LIMITS.buttonTitle) })) };
  }
  if (step.style === "text") {
    const lines = choices.map((c, i) => `${i + 1}. ${c.title}`).join("\n");
    return { kind: "text", body: clip(`${body}\n${lines}`, WA_LIMITS.body) };
  }
  const rows: ReplyOption[] = choices.slice(0, WA_LIMITS.listRows).map((c) => ({
    id: c.id,
    title: clip(c.title, WA_LIMITS.rowTitle),
    ...(c.description ? { description: clip(c.description, 72) } : {}),
  }));
  return { kind: "list", body, buttonLabel: pick(step.field === "booking" ? TEXT.pickTime : TEXT.choose, lang), rows };
}

/* ---------- Understanding typed answers ---------- */

// Keywords per field and value, English and Arabic (stored raw, normalised on use).
const KEYWORDS: Record<string, Record<string, string[]>> = {
  language: {
    en: ["english", "eng", "انجليزي", "انقليزي", "إنجليزي", "الانجليزية"],
    ar: ["arabic", "arabi", "عربي", "العربية", "عربى"],
  },
  intent: {
    buy: ["buy", "buying", "purchase", "own", "شراء", "اشتري", "أشتري", "بشتري", "شري", "تملك", "أتملك"],
    rent: ["rent", "renting", "lease", "leasing", "tenant", "إيجار", "ايجار", "أستأجر", "استأجر", "تأجير", "اجار", "أجار"],
    browsing: ["brows", "just looking", "looking around", "not sure yet", "window shopping", "اتفرج", "أتفرج", "تصفح", "بس أشوف", "بس اشوف", "مجرد", "اطالع"],
  },
  purpose: {
    live: ["live", "living", "home for", "family", "end user", "end-user", "myself", "move in", "سكن", "أسكن", "للسكن", "عائلة", "عايلة", "أعيش"],
    invest: ["invest", "rental income", "roi", "yield", "return", "استثمار", "أستثمر", "استثمر", "عائد", "دخل"],
  },
  propertyType: {
    apartment: ["apartment", "apt", "flat", "condo", "شقة", "شقه", "شقق"],
    villa: ["villa", "فيلا", "فلة", "فيلة", "فله"],
    townhouse: ["townhouse", "town house", "تاون هاوس", "تاونهاوس"],
    penthouse: ["penthouse", "بنتهاوس", "بنت هاوس", "بينتهاوس"],
    any: ["any", "anything", "open to", "no preference", "doesn't matter", "dont mind", "don't mind", "whatever", "أي نوع", "اي نوع", "أي شي", "اي شي", "ما يفرق", "مايفرق", "كله", "مو مهم"],
  },
  payment: {
    cash: ["cash", "كاش", "نقد", "نقدا", "نقدًا", "كاش داون"],
    mortgage: ["mortgage", "loan", "finance", "financing", "bank", "تمويل", "قرض", "رهن", "بنك"],
  },
  timeline: {
    now: ["this month", "now", "asap", "immediately", "urgent", "right away", "this week", "today", "هذا الشهر", "هالشهر", "الشهر هذا", "الحين", "الحين", "حاليا", "فورا", "فورًا", "حالا", "مستعجل", "بسرعة", "هالاسبوع"],
    "1-3m": ["1-3", "1 to 3", "one to three", "few months", "couple of months", "next month", "soon", "شهرين", "خلال شهر", "الشهر الجاي", "الشهر القادم", "كم شهر", "قريب"],
    later: ["later", "next year", "no rush", "not urgent", "not in a hurry", "not sure", "not yet", "no hurry", "بعدين", "لاحقا", "لاحقًا", "السنة الجاية", "السنة القادمة", "مو مستعجل", "مب مستعجل", "مش مستعجل", "ما ني مستعجل", "مو متأكد"],
  },
  booking: {
    call: ["call", "phone", "ring me", "اتصال", "اتصل", "اتصلوا", "مكالمة", "كلموني", "تلفون"],
  },
};

const ARABIC = /[؀-ۿ]/;
const LATIN_WORD = /[a-z0-9]/;
const AR_PREFIXES = ["", "و", "ب", "ل", "ف", "ال", "لل", "بال", "وال", "وب", "ول"];

/** Where a keyword occurs in normalised text, respecting word starts; null when absent. */
function findKeyword(text: string, keyword: string): [number, number] | null {
  const kw = normalizeForMatch(keyword);
  if (!kw) return null;
  const arabic = ARABIC.test(kw);
  let from = 0;
  for (;;) {
    const i = text.indexOf(kw, from);
    if (i < 0) return null;
    from = i + 1;
    const before = text.slice(0, i);
    const after = text[i + kw.length] ?? "";
    if (!arabic) {
      if (LATIN_WORD.test(before.slice(-1))) continue;
      if (/\d$/.test(kw) && /\d/.test(after)) continue;
      return [i, i + kw.length];
    }
    if (kw.length >= 4 || kw.includes(" ")) return [i, i + kw.length];
    // Short Arabic words must be a whole word, allowing attached و/ب/ل/ال.
    const word = /[؀-ۿ]*$/.exec(before)?.[0] ?? "";
    if (!AR_PREFIXES.includes(word)) continue;
    if (ARABIC.test(after)) continue;
    return [i - word.length, i + kw.length];
  }
}

/** Matches keywords; a hit inside a longer hit for another value (e.g. "مستعجل" in "مو مستعجل") doesn't count. */
function matchKeywords(text: string, table: Record<string, string[]> | undefined): string | null {
  if (!table) return null;
  const hits: Array<{ value: string; start: number; end: number }> = [];
  for (const [value, words] of Object.entries(table)) {
    for (const w of words) {
      const span = findKeyword(text, w);
      if (span) hits.push({ value, start: span[0], end: span[1] });
    }
  }
  const kept = hits.filter((h) => !hits.some((o) => o.value !== h.value && o.start <= h.start && o.end >= h.end && o.end - o.start > h.end - h.start));
  const values = new Set(kept.map((h) => h.value));
  return values.size === 1 ? [...values][0] : null;
}

const EN_COUNT: Record<string, number> = { one: 1, single: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const AR_COUNT: Array<[string, number]> = [
  ["غرفتين", 2],
  ["غرفه وحده", 1],
  ["غرفه واحده", 1],
  ["وحده", 1],
  ["واحده", 1],
  ["ثلاث", 3],
  ["اربع", 4],
  ["خمس", 5],
  ["ست", 6],
];

function parseBedrooms(text: string): number | null {
  if (/(studio|استديو|استوديو|ستوديو)/.test(text)) return 0;
  const digits = /(?:^|\D)(\d{1,2})(?!\d)/.exec(text);
  if (digits) return Number(digits[1]);
  for (const [word, n] of Object.entries(EN_COUNT)) if (findKeyword(text, word)) return n;
  for (const [word, n] of AR_COUNT) if (findKeyword(text, word)) return n;
  return null;
}

function parseRange(value: string | number | null): { min: number; max: number | null } | null {
  if (typeof value === "number") return { min: 0, max: value };
  const m = typeof value === "string" ? BUDGET_RANGE.exec(value) : null;
  return m ? { min: Number(m[1]), max: m[2] ? Number(m[2]) : null } : null;
}

/** The budget the lead typed: the largest amount written with a unit, currency or as a full figure. */
function parseBudget(text: string): number | null {
  const amounts = extractAmounts(text).filter((a) => !a.percent && (a.unit || a.currency || a.value >= 1000));
  return amounts.length ? Math.max(...amounts.map((a) => a.value)) : null;
}

function parseMonths(text: string): string | null {
  const m = /(\d{1,2})\s*(?:-\s*\d{1,2}\s*)?(months?|mos?|weeks?|wks?|years?|yrs?|شهر|شهور|اشهر|أشهر|اسبوع|اسابيع|سنه|سنوات|سنين)/.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2];
  if (/^(week|wk|اسبوع|اسابيع)/.test(unit)) return n <= 4 ? "now" : "1-3m";
  if (/^(year|yr|سنه|سنوات|سنين)/.test(unit)) return "later";
  if (n <= 3) return "1-3m";
  return "later";
}

function matchChoice(step: FlowStep, choices: Choice[], input: InboundInput): Choice | null {
  if (input.replyId) {
    const tapped = choices.find((c) => c.id === input.replyId);
    if (tapped) return tapped;
  }
  const raw = input.text?.trim();
  if (!raw) return null;
  const text = normalizeForMatch(raw).replace(/[.!?؟،,]+$/g, "").trim();
  if (!text) return null;

  const exact = choices.filter((c) => c.titles.some((t) => normalizeForMatch(t) === text));
  if (exact.length === 1) return exact[0];

  const byValue = (v: string | number | null) => choices.find((c) => c.value === v) ?? null;
  const field = step.field;
  const index = /^(\d{1,2})[.)]?$/.exec(text);

  if (field === "bedrooms") {
    const n = parseBedrooms(text);
    if (n === null) return null;
    const numeric = choices.filter((c) => typeof c.value === "number") as Array<Choice & { value: number }>;
    const hit = numeric.find((c) => c.value === n);
    if (hit) return hit;
    const top = numeric.reduce<(Choice & { value: number }) | null>((a, c) => (!a || c.value > a.value ? c : a), null);
    return top && n > top.value ? top : null;
  }

  if (field === "budgetMin" || field === "budgetMax") {
    const amount = parseBudget(text);
    if (amount !== null) {
      return (
        choices.find((c) => {
          const r = parseRange(c.value);
          if (!r) return false;
          const aboveMin = r.min === 0 ? amount >= 0 : amount > r.min;
          return aboveMin && (r.max === null || amount <= r.max);
        }) ?? null
      );
    }
    if (index) return choices[Number(index[1]) - 1] ?? null;
    return null;
  }

  if (field === "timeline") {
    const v = matchKeywords(text, KEYWORDS.timeline) ?? parseMonths(text);
    if (v) return byValue(v);
  } else if (field === "booking") {
    if (matchKeywords(text, KEYWORDS.booking) === "call") return byValue("call");
  } else if (typeof field === "string") {
    const v = matchKeywords(text, KEYWORDS[field]);
    if (v) {
      const hit = byValue(v);
      if (hit) return hit;
    }
  }

  // A title typed inside a longer message, e.g. "I'd like a villa please".
  const contained = choices.filter((c) => c.titles.some((t) => {
    const nt = normalizeForMatch(t);
    return nt.length >= 3 && findKeyword(text, nt) !== null;
  }));
  if (contained.length === 1) return contained[0];

  if (index) return choices[Number(index[1]) - 1] ?? null;

  // On the language question, the script the lead writes in is a good answer.
  if (field === "language") {
    if (ARABIC.test(text)) return byValue("ar");
    if (/[a-z]{2,}/.test(text)) return byValue("en");
  }
  return null;
}

/* ---------- Moving through the steps ---------- */

function knownAnswer(step: FlowStep, q: Qualification): { known: boolean; next?: string } {
  const f = step.field;
  if (!f || f === "language" || f === "booking") return { known: false };
  if (f === "budgetMin" || f === "budgetMax") {
    return { known: q.budgetMin !== undefined || q.budgetMax !== undefined };
  }
  const v = q[f];
  if (v === undefined || v === null || v === "") return { known: false };
  return { known: true, next: step.options.find((o) => o.value === v)?.next };
}

function resolveStep(def: FlowDefinition, id: string | undefined, q: Qualification, ctx: FlowContext): FlowStep | null {
  const seen = new Set<string>();
  let cur = id;
  while (cur && cur !== FLOW_END && !seen.has(cur)) {
    seen.add(cur);
    const step = def.steps.find((s) => s.id === cur);
    if (!step) return null;
    const skipWhen = step.when && q[step.when.field] !== step.when.equals;
    const skipBooking = step.field === "booking" && ctx.slots.length === 0;
    const known = knownAnswer(step, q);
    if (!skipWhen && !skipBooking && !known.known) return step;
    cur = known.known ? known.next ?? step.next : step.next;
  }
  return null;
}

function finish(def: FlowDefinition, lang: Lang, ctx: FlowContext): OutgoingMessage {
  return { kind: "text", body: clip(fill(pick(def.done, lang), ctx, lang), WA_LIMITS.body) };
}

function handoffResult(def: FlowDefinition, lang: Lang, ctx: FlowContext): FlowResult {
  return {
    state: { stepId: null, lang, retries: 0 },
    messages: [{ kind: "text", body: clip(fill(pick(def.handoff, lang), ctx, lang), WA_LIMITS.body) }],
    patch: {},
    booking: null,
    handoff: true,
  };
}

/** Greeting plus the first question. */
export function startFlow(def: FlowDefinition, lang: Lang, ctx: FlowContext): FlowResult {
  const greeting: OutgoingMessage = { kind: "text", body: clip(fill(pick(def.greeting, lang), ctx, lang), WA_LIMITS.body) };
  const first = resolveStep(def, def.start, ctx.qualification, ctx);
  return {
    state: { stepId: first?.id ?? null, lang, retries: 0 },
    messages: [greeting, first ? stepMessage(first, lang, ctx) : finish(def, lang, ctx)],
    patch: {},
    booking: null,
    handoff: false,
  };
}

/** Applies the lead's answer (tap or typed text) and asks the next question. */
export function advanceFlow(def: FlowDefinition, state: FlowState, input: InboundInput, ctx: FlowContext): FlowResult {
  let lang = state.lang;
  if (!state.stepId) return { state, messages: [], patch: {}, booking: null, handoff: false };
  const step = def.steps.find((s) => s.id === state.stepId);
  if (!step) return handoffResult(def, lang, ctx);

  const choices = choicesFor(step, lang, ctx);
  const choice = matchChoice(step, choices, input);
  const patch: Partial<Qualification> = {};
  const messages: OutgoingMessage[] = [];
  let booking: { slotId: string } | null = null;
  let next = step.next;

  if (choice) {
    next = choice.next ?? step.next;
    const f = step.field;
    if (f === "language") {
      if (choice.value === "en" || choice.value === "ar") lang = choice.value;
    } else if (f === "booking") {
      if (choice.slotId) {
        booking = { slotId: choice.slotId };
        const slot = ctx.slots.find((s) => s.id === choice.slotId);
        messages.push({ kind: "text", body: pick(TEXT.booked, lang).replace("{time}", slot ? formatSlot(slot.startsAt, lang) : choice.title) });
      } else if (choice.value === "call") {
        patch.notes = ctx.qualification.notes ? `${ctx.qualification.notes}\n${TEXT.callNote}` : TEXT.callNote;
        messages.push({ kind: "text", body: pick(TEXT.callBack, lang) });
      }
    } else if (f === "budgetMin" || f === "budgetMax") {
      const r = typeof choice.value === "string" ? parseRange(choice.value) : null;
      if (r) {
        if (r.min > 0) patch.budgetMin = r.min;
        if (r.max !== null) patch.budgetMax = r.max;
      } else if (typeof choice.value === "number") patch[f] = choice.value;
    } else if (f && choice.value !== null) {
      (patch as Record<string, unknown>)[f] = choice.value;
    }
  } else if (step.options.length === 0 && step.field !== "booking" && input.text?.trim()) {
    // Free-text question (e.g. area): take what the lead wrote.
    const text = input.text.trim();
    const f = step.field;
    if (f === "bedrooms") {
      const n = parseBedrooms(normalizeForMatch(text));
      if (n === null) return retryOrHandoff(def, step, state, lang, ctx);
      patch.bedrooms = n;
    } else if (f === "budgetMin" || f === "budgetMax") {
      const amount = parseBudget(text);
      if (amount === null) return retryOrHandoff(def, step, state, lang, ctx);
      patch[f] = amount;
    } else if (f === "area" || f === "notes") {
      patch[f] = text.slice(0, 200);
    }
  } else {
    return retryOrHandoff(def, step, state, lang, ctx);
  }

  const q = { ...ctx.qualification, ...patch };
  const following = resolveStep(def, next, q, ctx);
  messages.push(following ? stepMessage(following, lang, ctx) : finish(def, lang, ctx));
  return { state: { stepId: following?.id ?? null, lang, retries: 0 }, messages, patch, booking, handoff: false };
}

function retryOrHandoff(def: FlowDefinition, step: FlowStep, state: FlowState, lang: Lang, ctx: FlowContext): FlowResult {
  if (state.retries >= 1) return handoffResult(def, lang, ctx);
  return {
    state: { stepId: step.id, lang, retries: state.retries + 1 },
    messages: [{ kind: "text", body: pick(TEXT.retry, lang) }, stepMessage(step, lang, ctx)],
    patch: {},
    booking: null,
    handoff: false,
  };
}
