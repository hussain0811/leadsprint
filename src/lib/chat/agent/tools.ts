import type OpenAI from "openai";
import { z } from "zod";
import type { Qualification } from "../types";

// The agent's tools: definitions sent to the model and validation of the arguments it sends back.
// Pure, so it can be tested without a database. The tool list never changes within a conversation.

export const TOOL_NAMES = [
  "search_knowledge",
  "search_listings",
  "save_qualification",
  "list_slots",
  "book_viewing",
  "send_document",
  "handoff_to_human",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

const PROPERTY_TYPES = ["apartment", "villa", "townhouse", "penthouse"] as const;

export const TOOLS: OpenAI.Chat.Completions.ChatCompletionFunctionTool[] = [
  tool("search_knowledge", "Search the business's brochures, FAQs and documents. Use it for any question about a project, payment plans, amenities, fees or the buying process. Answer only from the passages returned.", {
    query: { type: "string", description: "The question as search words, in the language of the documents (usually English)." },
  }, ["query"]),
  tool("search_listings", "Find available units for sale or rent with their exact prices and sizes. All filters are optional.", {
    bedrooms: { type: "integer", minimum: 0, maximum: 20, description: "Number of bedrooms; 0 = studio." },
    min_price: { type: "number", minimum: 0, description: "Lowest price in AED." },
    max_price: { type: "number", minimum: 0, description: "Highest price in AED." },
    type: { type: "string", enum: [...PROPERTY_TYPES, "any"] },
  }),
  tool("save_qualification", "Save what the lead told you about their needs. Send only the fields you learned; leave out the rest.", {
    intent: {
      type: "string",
      enum: ["buy", "rent", "browsing"],
      description:
        'Only what the lead said. "browsing" only when they say they are just looking; asking about a home or giving a budget is not browsing. Leave it out if unclear.',
    },
    purpose: { type: "string", enum: ["live", "invest"] },
    budgetMin: { type: "number", minimum: 0, description: 'AED. Only for "from", "at least" or the low end of a range.' },
    budgetMax: {
      type: "number",
      minimum: 0,
      description: 'AED. A single figure ("around 2.5 million", "up to 2M") is the maximum; a range sets both.',
    },
    propertyType: { type: "string", enum: [...PROPERTY_TYPES, "any"] },
    bedrooms: { type: "integer", minimum: 0, maximum: 20, description: "0 = studio" },
    payment: { type: "string", enum: ["cash", "mortgage"] },
    timeline: { type: "string", enum: ["now", "1-3m", "later"] },
    area: { type: "string", description: "Preferred area or community." },
    notes: { type: "string", description: "Anything else useful for the sales agent, in one short sentence." },
  }),
  tool("list_slots", "List the next free viewing times for this project. Offer these to the lead; never invent times.", {}),
  tool("book_viewing", "Book a viewing in a free slot the lead chose from list_slots.", {
    slot_id: { type: "string", description: "The slot id from list_slots." },
  }, ["slot_id"]),
  tool("send_document", "Send the lead a brochure, floor plan or other file from the list of documents you can send.", {
    source_id: { type: "string", description: "The document id from the business data." },
  }, ["source_id"]),
  tool("handoff_to_human", "Pass the conversation to a person on the sales team. Use it when you can't answer from the data, the lead asks for a person, wants to negotiate, or asks about returns, visas, mortgages or legal matters.", {
    reason: { type: "string", description: "Why, in one short sentence for the sales team." },
  }, ["reason"]),
];

function tool(
  name: ToolName,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = [],
): OpenAI.Chat.Completions.ChatCompletionFunctionTool {
  return {
    type: "function",
    function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } },
  };
}

/* ---------- Argument validation ---------- */

// Models often send null or "" for fields they don't know, and numbers as strings. Accept those.
const dropEmpty = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null && v !== undefined && v !== ""));
};
const num = (schema: z.ZodNumber) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v.replace(/,/g, ""))) ? Number(v.replace(/,/g, "")) : v), schema);
const lower = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), schema);

const MAX_PRICE = 10_000_000_000;

export const qualificationSchema = z.preprocess(
  dropEmpty,
  z
    .object({
      intent: lower(z.enum(["buy", "rent", "browsing"])).optional(),
      purpose: lower(z.enum(["live", "invest"])).optional(),
      budgetMin: num(z.number().min(0).max(MAX_PRICE)).optional(),
      budgetMax: num(z.number().min(0).max(MAX_PRICE)).optional(),
      propertyType: lower(z.enum([...PROPERTY_TYPES, "any"])).optional(),
      bedrooms: num(z.number().int().min(0).max(20)).optional(),
      payment: lower(z.enum(["cash", "mortgage"])).optional(),
      timeline: lower(z.enum(["now", "1-3m", "later"])).optional(),
      area: z.string().trim().min(1).max(100).optional(),
      notes: z.string().trim().min(1).max(500).optional(),
    })
    .strict()
    .refine((q) => q.budgetMin === undefined || q.budgetMax === undefined || q.budgetMin <= q.budgetMax, {
      message: "budgetMin must not be above budgetMax",
    })
    .refine((q) => Object.keys(q).length > 0, { message: "Send at least one field you learned." }),
);

const ARG_SCHEMAS = {
  search_knowledge: z.object({ query: z.string().trim().min(1).max(300) }),
  search_listings: z.preprocess(
    dropEmpty,
    z
      .object({
        bedrooms: num(z.number().int().min(0).max(20)).optional(),
        min_price: num(z.number().min(0).max(MAX_PRICE)).optional(),
        max_price: num(z.number().min(0).max(MAX_PRICE)).optional(),
        type: lower(z.enum([...PROPERTY_TYPES, "any"])).optional(),
      })
      .strict(),
  ),
  save_qualification: qualificationSchema,
  list_slots: z.preprocess(dropEmpty, z.object({}).strict()),
  book_viewing: z.object({ slot_id: z.string().trim().min(1).max(100) }),
  send_document: z.object({ source_id: z.string().trim().min(1).max(100) }),
  handoff_to_human: z.object({ reason: z.string().trim().min(1).max(500) }),
} satisfies Record<ToolName, z.ZodType>;

export type ToolArgs = {
  search_knowledge: { query: string };
  search_listings: { bedrooms?: number; min_price?: number; max_price?: number; type?: (typeof PROPERTY_TYPES)[number] | "any" };
  save_qualification: Partial<Qualification>;
  list_slots: Record<string, never>;
  book_viewing: { slot_id: string };
  send_document: { source_id: string };
  handoff_to_human: { reason: string };
};

export type ParsedCall = { [K in ToolName]: { ok: true; name: K; args: ToolArgs[K] } }[ToolName] | { ok: false; error: string };

export function isToolName(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name);
}

/** Parses and validates a tool call's JSON arguments; errors are plain sentences to send back to the model. */
export function parseToolCall(name: string, rawArgs: string | null | undefined): ParsedCall {
  if (!isToolName(name)) return { ok: false, error: `There is no tool called "${name}". Use one of: ${TOOL_NAMES.join(", ")}.` };
  let value: unknown = {};
  if (rawArgs && rawArgs.trim()) {
    try {
      value = JSON.parse(rawArgs);
    } catch {
      return { ok: false, error: "The arguments were not valid JSON." };
    }
  }
  const parsed = ARG_SCHEMAS[name].safeParse(value);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message));
    return { ok: false, error: `Invalid arguments for ${name}: ${problems.join("; ")}` };
  }
  return { ok: true, name, args: parsed.data } as ParsedCall;
}
