import type { ReactNode } from "react";
import { StatusMark } from "@/components/ui";
import type { Score } from "@/lib/chat/types";
import { SCORE_LABEL, SCORE_TONE } from "@/lib/leads/present";

// Pieces shared by the Leads list and the lead detail page. Only client components import this file.

export const LINK = "text-marina underline underline-offset-2";

export function errorText(err: unknown) {
  if (err instanceof TypeError && /fetch|network|load failed/i.test(err.message)) {
    return "Couldn't reach LeadSprint. Check the app is still running, then try again.";
  }
  return err instanceof Error ? err.message : String(err);
}

export function leadPath(id: string, suffix = "") {
  return `/api/leads/${encodeURIComponent(id)}${suffix}`;
}

export function ScoreMark({ score }: { score: Score }) {
  return <StatusMark tone={SCORE_TONE[score]}>{SCORE_LABEL[score]}</StatusMark>;
}

// Names, notes and summaries can be Arabic: isolate them so punctuation around them stays in place.
export function UserText({ children, fallback = "No name" }: { children: string | null; fallback?: ReactNode }) {
  if (!children) return <span className="text-muted">{fallback}</span>;
  return <bdi dir="auto">{children}</bdi>;
}

export function Phone({ phone }: { phone: string | null }) {
  if (!phone) return <span className="text-muted">No phone</span>;
  return (
    <span dir="ltr" className="tabular-nums">
      {phone}
    </span>
  );
}
