// Shared shapes for the Leads list, the lead detail page and their API routes. No server-only imports.

import type { Qualification, Score } from "@/lib/chat/types";

export const LEAD_STATUSES = ["new", "qualifying", "qualified", "handed_off", "closed"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const SCORES: Score[] = ["hot", "warm", "cold", "unknown"];

export const LEAD_SOURCES = ["simulator", "web", "form", "webhook", "csv"] as const;

export const PAGE_SIZE = 25;

export type LeadSort = "newest" | "score";

// "none" = leads with no project.
export type LeadFilters = {
  score: Score | null;
  status: LeadStatus | null;
  projectId: string | null;
  needsPerson: boolean;
  q: string;
  sort: LeadSort;
  page: number; // 1-based
};

export type BookingView = {
  id: string;
  startsAt: string;
  kind: string; // viewing | call
  status: string; // booked | cancelled | done
  projectName: string | null;
};

export type LeadRow = {
  id: string;
  name: string | null;
  phone: string | null;
  projectId: string | null;
  projectName: string | null;
  score: Score;
  status: string;
  keyAnswers: string; // "Buy · AED 1M to 2M · 2 bedrooms · In 1 to 3 months"
  needsPerson: boolean;
  nextBooking: BookingView | null;
  source: string;
  lastActivityAt: string;
  createdAt: string;
};

export type ProjectChoice = { id: string; name: string };

// GET /api/leads?score&status&project&needsPerson&q&sort&page
export type LeadListResponse = {
  leads: LeadRow[];
  total: number;
  page: number;
  pageCount: number;
  projects: ProjectChoice[];
};

export type ConversationLink = {
  id: string;
  channel: string;
  needsHuman: boolean;
  humanTakeover: boolean;
  messageCount: number;
  updatedAt: string;
};

// GET/PATCH /api/leads/[id] -> { lead: LeadDetail }
export type LeadDetail = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  projectId: string | null;
  projectName: string | null;
  source: string;
  language: string;
  status: string;
  score: Score;
  scoreReasons: string[];
  qualification: Qualification;
  summary: string | null;
  strikes: number;
  aiStopped: boolean;
  blocked: boolean;
  tokensUsed: number;
  needsPerson: boolean;
  createdAt: string;
  lastActivityAt: string;
  bookings: BookingView[];
  conversations: ConversationLink[];
};
