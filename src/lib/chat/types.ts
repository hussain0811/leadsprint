// Shared contract for step 8 (chat tester): the flow engine, guard, AI agent, API routes and
// the Chat tester, Flows and Settings pages all build against these types. No server-only imports.

export type Lang = "en" | "ar";
export type Localized = { en: string; ar: string };

/* ---------- Org settings (stored as JSON in Org.settings) ---------- */

export type OrgSettings = {
  maxMessageChars: number; // longer lead messages get a polite "please keep it short", no AI call
  leadMessagesPerMinute: number;
  strikeLimit: number; // strikes before the AI stops for a lead
  offTopicStreakForStrike: number; // plain off-topic messages in a row that count as one strike
  leadTokenBudget: number; // AI tokens per lead, lifetime
  monthlyTokenBudget: number; // AI tokens per org per calendar month
  scopeCheck: boolean; // run the topic check before the main AI reply
  maxReplyChars: number;
  allowedLinkDomains: string[]; // links the AI may send (the org's own sites)
  allowedPhones: string[]; // phone numbers the AI may share
};

export const DEFAULT_SETTINGS: OrgSettings = {
  maxMessageChars: 1000,
  leadMessagesPerMinute: 8,
  strikeLimit: 3,
  offTopicStreakForStrike: 5,
  leadTokenBudget: 60_000,
  monthlyTokenBudget: 2_000_000,
  scopeCheck: true,
  maxReplyChars: 700,
  allowedLinkDomains: [],
  allowedPhones: [],
};

/* ---------- Messages (Message.kind + Message.payload) ---------- */

// WhatsApp limits the simulator enforces.
export const WA_LIMITS = { buttons: 3, buttonTitle: 20, listRows: 10, rowTitle: 24, body: 1024 } as const;

export type ReplyOption = { id: string; title: string; description?: string };

export type OutgoingMessage =
  | { kind: "text"; body: string }
  | { kind: "buttons"; body: string; buttons: ReplyOption[] }
  | { kind: "list"; body: string; buttonLabel: string; rows: ReplyOption[] }
  | { kind: "document"; body: string; document: { sourceId: string; title: string; fileName: string | null } }
  | { kind: "note"; body: string }; // shown to the admin only, e.g. "Handed to a human"

// What the lead sends: free text, or a tap on a button or list row.
export type InboundInput = { text?: string; replyId?: string };

export type MessageView = {
  id: string;
  direction: "in" | "out";
  author: "lead" | "bot" | "ai" | "agent" | "system";
  message: OutgoingMessage; // inbound messages are { kind: "text" }
  createdAt: string;
};
/* ---------- Qualification and scoring ---------- */

export type Qualification = {
  intent?: "buy" | "rent" | "browsing";
  purpose?: "live" | "invest";
  budgetMin?: number; // AED
  budgetMax?: number; // AED
  propertyType?: "apartment" | "villa" | "townhouse" | "penthouse" | "any";
  bedrooms?: number; // 0 = studio
  payment?: "cash" | "mortgage";
  timeline?: "now" | "1-3m" | "later";
  area?: string;
  notes?: string;
};

export type Score = "hot" | "warm" | "cold" | "unknown";

/* ---------- Scripted flow (Flow.definition) ---------- */

// One question; the answer fills `field` with the chosen option's value.
export type FlowStep = {
  id: string;
  field: keyof Qualification | "language" | "booking" | null;
  ask: Localized;
  style: "buttons" | "list" | "text";
  options: Array<{ id: string; title: Localized; value: string | number | null; next?: string }>;
  next?: string; // default next step id; omitted = flow ends
  // Only ask when an earlier answer matches, e.g. purpose only when intent is "buy".
  when?: { field: keyof Qualification; equals: string | number };
};

export type FlowDefinition = {
  greeting: Localized; // must say it's an automated assistant
  start: string; // first step id
  steps: FlowStep[];
  done: Localized;
  handoff: Localized; // said when the bot gives up and passes to a person
};

export type FlowState = {
  stepId: string | null; // null = finished
  lang: Lang;
  retries: number; // failed matches on the current step
};

export type FlowResult = {
  state: FlowState;
  messages: OutgoingMessage[];
  patch: Partial<Qualification>;
  booking?: { slotId: string } | null;
  handoff: boolean;
};

/* ---------- Guard ---------- */

export type FreeCheckResult =
  | { ok: true }
  | { ok: false; reason: "too_long" | "rate_limited" | "abuse_pattern" | "blocked"; strike: boolean; reply: Localized | null };

export type ScopeLabel = "on_topic" | "small_talk" | "off_topic" | "abuse";

export type ReplyCheckResult = { ok: true } | { ok: false; reason: string };

/* ---------- One bot turn, as shown in the tester's side panel ---------- */

export type TurnTrace = {
  mode: "scripted" | "ai" | "human" | "none"; // who answered ("human" = takeover, no bot reply)
  why: string; // plain reason, e.g. "No AI connection", "Strike limit reached", "AI error, scripted fallback"
  freeCheck: FreeCheckResult;
  scope: ScopeLabel | null;
  toolCalls: Array<{ name: string; input: unknown; output: unknown }>;
  passages: Array<{ title: string; page: number | null }>;
  replyCheck: ReplyCheckResult | null;
  tokens: { input: number; output: number } | null;
  ms: number;
  error: string | null;
};

/* ---------- AI agent ---------- */

export type AgentTurnResult = {
  messages: OutgoingMessage[]; // empty = the agent produced nothing usable
  patch: Partial<Qualification>;
  booking: { slotId: string } | null;
  handoff: boolean;
  scope: ScopeLabel | null;
  toolCalls: TurnTrace["toolCalls"];
  passages: TurnTrace["passages"];
  replyCheck: ReplyCheckResult | null;
  tokens: { input: number; output: number };
  error: string | null;
};

/* ---------- API shapes (route handlers <-> Chat tester page) ---------- */

export type LeadSnapshot = {
  id: string;
  name: string | null;
  phone: string | null;
  projectId: string | null;
  projectName: string | null;
  language: Lang;
  status: string;
  score: Score;
  scoreReasons: string[];
  qualification: Qualification;
  summary: string | null;
  strikes: number;
  aiStopped: boolean;
  tokensUsed: number;
  booking: { startsAt: string; kind: string } | null;
};

export type ConversationView = {
  id: string;
  lead: LeadSnapshot;
  forceScripted: boolean;
  humanTakeover: boolean;
  needsHuman: boolean;
  windowOpenUntil: string | null; // WhatsApp 24-hour window, from the last inbound message
  messages: MessageView[];
  lastTrace: TurnTrace | null;
};

export type ConversationSummary = { id: string; leadName: string | null; projectName: string | null; updatedAt: string; lastMessage: string };

// POST /api/chat/conversations        body StartConversationRequest -> 201 ConversationView
// GET  /api/chat/conversations        -> { conversations: ConversationSummary[] }
// GET  /api/chat/conversations/[id]   -> ConversationView
// POST /api/chat/conversations/[id]/messages  body InboundInput -> ConversationView (after the bot's turn)
// PATCH /api/chat/conversations/[id]  body { forceScripted?, humanTakeover? } -> ConversationView
// POST /api/chat/conversations/[id]/agent-reply body { text } -> ConversationView (a person replies during takeover)
// DELETE /api/chat/conversations/[id] -> { ok: true } (deletes the test lead too)
// GET/PUT /api/flows                  -> { definition: FlowDefinition } (PUT validates it)
// GET/PUT /api/settings               -> { settings: OrgSettings }
export type StartConversationRequest = { name: string; phone: string; projectId: string | null; language: Lang };
