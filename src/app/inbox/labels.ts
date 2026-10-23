import type { Tone } from "@/components/ui";
import type { MessageView, Score } from "@/lib/chat/types";
import type { Answering } from "@/lib/inbox/types";

// Plain words for the inbox's statuses, shared by the list and the thread.

export const SCORE_LABEL: Record<Score, [Tone, string]> = {
  hot: ["ok", "Hot"],
  warm: ["warn", "Warm"],
  cold: ["muted", "Cold"],
  unknown: ["muted", "Not scored"],
};

export const ANSWERING_LABEL: Record<Answering, string> = {
  ai: "AI agent answering",
  scripted: "Scripted bot answering",
  person: "A person is answering",
};

export const ANSWERING_SHORT: Record<Answering, string> = { ai: "AI", scripted: "Scripted", person: "Person" };

export function authorLabel(author: MessageView["author"] | string | null, leadName: string | null): string {
  switch (author) {
    case "lead":
      return leadName || "Lead";
    case "bot":
      return "Scripted bot";
    case "ai":
      return "AI agent";
    case "agent":
      return "Your team (person)";
    default:
      return "System";
  }
}

export function inboxThreadHref(id: string) {
  return `/inbox?c=${encodeURIComponent(id)}`;
}
