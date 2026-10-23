// Shared shapes for the Inbox page and its API route. No server-only imports.
import type { Score } from "@/lib/chat/types";

/** Who answers the lead's next message. */
export type Answering = "ai" | "scripted" | "person";

export type InboxItem = {
  id: string; // conversation id
  leadId: string;
  leadName: string | null;
  leadPhone: string | null;
  projectId: string | null;
  projectName: string | null;
  score: Score;
  needsHuman: boolean;
  humanTakeover: boolean;
  answering: Answering;
  lastMessage: string; // preview text, already shortened
  lastAuthor: string | null; // lead | bot | ai | agent | system
  lastActivityAt: string; // newest message, or when the conversation started
};

export type InboxFilters = {
  needsHuman: boolean;
  takeover: boolean;
  projectId: string | null; // "none" = leads without a project
  q: string;
};

export type InboxResponse = {
  items: InboxItem[];
  projects: Array<{ id: string; name: string }>;
  counts: { needsHuman: number; takeover: number };
};

// GET   /api/inbox?needs=1&takeover=1&project=<id|none>&q=<text>  -> InboxResponse
// PATCH /api/inbox/conversations/[id]  body { needsHuman: boolean } -> ConversationView
// Take over, hand back, replies and the thread itself reuse /api/chat/conversations/[id].
