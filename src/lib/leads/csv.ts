import type { Qualification, Score } from "@/lib/chat/types";
import {
  answerRows,
  BOOKING_STATUS_LABEL,
  dubaiDateTime,
  KIND_LABEL,
  SCORE_LABEL,
  sourceLabel,
  statusLabel,
  toCsv,
} from "./present";
import type { LeadRow } from "./types";

// The CSV export: one row per lead, plain-language values, UTF-8 with a BOM for Excel. No server-only imports.

export type ExportLead = {
  row: LeadRow;
  email: string | null;
  language: string;
  scoreReasons: string[];
  qualification: Qualification;
  summary: string | null;
};

const ANSWER_LABELS = answerRows({}).map((r) => r.label);

export const CSV_HEADER = [
  "Name",
  "Phone",
  "Email",
  "Project",
  "Score",
  "Score reasons",
  "Status",
  ...ANSWER_LABELS,
  "Needs a person",
  "Booking",
  "Source",
  "Language",
  "Summary",
  "Created (UTC)",
  "Last activity (UTC)",
];

function utc(iso: string) {
  return iso.slice(0, 16).replace("T", " ");
}

export function leadsCsv(leads: ExportLead[]): string {
  return toCsv(
    CSV_HEADER,
    leads.map(({ row, email, language, scoreReasons, qualification, summary }) => {
      const b = row.nextBooking;
      return [
        row.name,
        row.phone,
        email,
        row.projectName,
        SCORE_LABEL[row.score as Score] ?? row.score,
        scoreReasons.join("; "),
        statusLabel(row.status),
        ...answerRows(qualification).map((a) => a.value),
        row.needsPerson ? "Yes" : "No",
        b ? `${KIND_LABEL[b.kind] ?? b.kind} ${dubaiDateTime(b.startsAt)} (Dubai), ${BOOKING_STATUS_LABEL[b.status] ?? b.status}` : "",
        sourceLabel(row.source),
        language === "ar" ? "Arabic" : "English",
        summary,
        utc(row.createdAt),
        utc(row.lastActivityAt),
      ];
    }),
  );
}

export function csvFileName(now = new Date()) {
  return `leads-${now.toISOString().slice(0, 10)}.csv`;
}
