// Shared contract between GET /api/dashboard and the dashboard page. No server-only imports.

export const PERIODS = ["today", "7d", "30d"] as const;
export type Period = (typeof PERIODS)[number];

export const PERIOD_LABELS: Record<Period, string> = { today: "Today", "7d": "Last 7 days", "30d": "Last 30 days" };

export function isPeriod(value: unknown): value is Period {
  return typeof value === "string" && (PERIODS as readonly string[]).includes(value);
}

export type Bucket = {
  start: string; // ISO, start of the hour or day (Dubai time)
  label: string; // full label for the table and tooltips, e.g. "Thu 22 Oct" or "14:00"
  count: number;
};

export type Tone = "ok" | "warn" | "bad" | "muted";

export type SetupItem = {
  key: "ai" | "storage" | "knowledge" | "projects" | "slots" | "flow";
  label: string;
  href: string;
  done: boolean;
  tone: Tone;
  detail: string;
};

export type HotLead = {
  id: string;
  name: string | null;
  phone: string | null;
  projectName: string | null;
  reasons: string[];
  updatedAt: string;
};

export type UpcomingBooking = {
  id: string;
  leadId: string;
  leadName: string | null;
  projectName: string | null;
  kind: string; // viewing | call
  startsAt: string;
};

export type DashboardData = {
  period: Period;
  from: string;
  to: string;
  leads: {
    new: number;
    hot: number;
    warm: number;
    cold: number;
    unknown: number;
    qualified: number;
    qualifiedRate: number | null; // 0..1, null when there were no new leads
    viewingsBooked: number;
    callsBooked: number;
    needingPerson: number; // right now, not limited to the period
  };
  perBucket: { unit: "hour" | "day"; buckets: Bucket[] };
  response: {
    conversations: number; // conversations where the lead wrote at least once
    withinMinute: number;
    withinMinuteRate: number | null;
    medianMs: number | null;
    unanswered: number;
  };
  answered: {
    ai: number;
    scripted: number;
    person: number; // replies a person sent during a takeover
    fallbacks: number; // AI turns that fell back to the scripted flow
    offTopic: number; // turns the topic check labelled off-topic or abuse
    refused: number; // messages refused by the free checks (too long, too fast, blocked)
    strikes: number;
    leadsWithStrikes: number;
    aiStoppedLeads: number;
    tokensThisMonth: number;
    monthlyBudget: number;
  };
  setup: SetupItem[];
  hotLeads: HotLead[];
  upcoming: UpcomingBooking[];
};
