import type { Qualification, Score } from "./types";

/** "950K", "1.5M", "2M". */
export function formatAed(n: number): string {
  const short = (v: number) => String(Math.round(v * 100) / 100);
  if (n >= 1e6) return `${short(n / 1e6)}M`;
  if (n >= 1e3) return `${short(n / 1e3)}K`;
  return String(n);
}

const TYPE_NAMES: Record<NonNullable<Qualification["propertyType"]>, string> = {
  apartment: "apartment",
  villa: "villa",
  townhouse: "townhouse",
  penthouse: "penthouse",
  any: "any property type",
};

/** Rule-based score with plain reasons, e.g. ["Wants to buy", "Budget AED 1M-2M", "Buying within 3 months"]. */
export function scoreLead(q: Qualification): { score: Score; reasons: string[] } {
  const reasons: string[] = [];
  const renting = q.intent === "rent";
  const verb = renting ? "Renting" : "Buying";

  if (q.intent === "buy") reasons.push("Wants to buy");
  else if (q.intent === "rent") reasons.push("Wants to rent");
  else if (q.intent === "browsing") reasons.push("Just browsing");

  if (q.purpose === "live") reasons.push("To live in");
  else if (q.purpose === "invest") reasons.push("As an investment");

  const hasBudget = q.budgetMin !== undefined || q.budgetMax !== undefined;
  if (hasBudget) {
    const perYear = renting ? " a year" : "";
    if (q.budgetMin !== undefined && q.budgetMax !== undefined) reasons.push(`Budget AED ${formatAed(q.budgetMin)}-${formatAed(q.budgetMax)}${perYear}`);
    else if (q.budgetMax !== undefined) reasons.push(`Budget up to AED ${formatAed(q.budgetMax)}${perYear}`);
    else if (q.budgetMin !== undefined) reasons.push(`Budget above AED ${formatAed(q.budgetMin)}${perYear}`);
  }

  if (q.propertyType || q.bedrooms !== undefined) {
    const beds = q.bedrooms === undefined ? "" : q.bedrooms === 0 ? "studio " : `${q.bedrooms}${q.bedrooms >= 4 ? "+" : ""}-bedroom `;
    const type = q.propertyType ? TYPE_NAMES[q.propertyType] : "home";
    reasons.push(`Looking for ${beds}${q.bedrooms === 0 && type === "apartment" ? "" : type}`.trim());
  }

  if (q.payment === "cash") reasons.push("Paying cash");
  else if (q.payment === "mortgage") reasons.push("Needs a mortgage");

  if (q.timeline === "now") reasons.push(`${verb} this month`);
  else if (q.timeline === "1-3m") reasons.push(`${verb} within 3 months`);
  else if (q.timeline === "later") reasons.push("Not in a hurry");

  if (q.area) reasons.push(`Interested in ${q.area}`);

  if (q.intent === "browsing") return { score: "cold", reasons };

  if (!q.intent) {
    if (reasons.length === 0) return { score: "unknown", reasons: ["Not enough answers yet"] };
    return { score: "warm", reasons: [...reasons, "Buy or rent not known yet"] };
  }

  const soon = q.timeline === "now" || q.timeline === "1-3m";
  if (hasBudget && soon) return { score: "hot", reasons };

  if (!hasBudget) reasons.push("No budget yet");
  if (!q.timeline) reasons.push("No timeline yet");
  return { score: "warm", reasons };
}
