# AI Lead-Qualifying Agent: Project Plan

> CyphronTech product · working name **LeadSprint** (placeholder) · revised 2026-10-19

**Decisions so far**
- Real estate first; first customers in the UAE and Saudi Arabia; built to go worldwide after the Gulf.
- Channels: web chat (real from day one), WhatsApp (**simulated until the first paying client**), SMS (Phase 3).
- **Fully bring-your-own (BYOK) SaaS:** customers pay us a monthly subscription for the software only. AI, WhatsApp, SMS, email to leads and document storage all run on the customer's own accounts and keys, billed to them directly by those providers. **CyphronTech pays for no AI or messaging anywhere in the product**, including document search and the public demo (which uses recordings, or the visitor's own key). See the BYOK map in §6.
- **A normal bot without a key** (scripted, button-based flow; needs no connections at all); **AI-powered with a key**: natural conversation, answers from the customer's documents, follows their rules documents, stays strictly on topic.
- Any major AI provider, or any compatible endpoint (including self-hosted models).
- Self-serve, priced in USD: free public beta in Phase 1; paid plans with a 14-day free trial from Phase 2.
- **Built by one developer with Claude Code**, so scope is phased (see §4 and §9).
- **Cheapest/simplest hosting** for now (Frankfurt); regional hosting when a customer requires it.

## 1. The pitch

Real estate brokerages and developers in Dubai, Abu Dhabi and Riyadh pay a lot for leads from Property Finder, Bayut, Dubizzle and Meta/TikTok/Google ads. Our working assumption, to confirm in customer calls: many of those leads wait hours for a callback and go to the next broker.

**LeadSprint replies within 60 seconds, qualifies the lead, books a viewing or a call, and hands the agent a scored lead.**

- **Without an AI key:** a fast scripted flow with buttons asks the qualifying questions, scores by rules, routes and books.
- **With the customer's AI key:** the same bot becomes a natural conversation in the buyer's own language. It follows the customer's rules (terms and conditions, policies) on every reply, checks their documents whenever a question needs them, and talks only about the customer's business, so the key can't be misused.

**What works when:** Phase 1 (free beta) handles conversations that start in the web chat widget on the customer's website, plus the WhatsApp simulator for demos. Messaging leads from ads and portals needs a real outbound channel, which arrives with real WhatsApp in Phase 2 (§4).

**Why fully BYOK sells:** no markup on AI or messaging, and transparent costs; the customer chooses every provider and keeps their data in their own accounts (documents in their own storage bucket, conversations processed under their own AI contract); companies with strict data rules can point it at Azure, AWS Bedrock or a self-hosted model in their own region (Azure and Bedrock are certified in Phase 3). That keeps the AI processing in their region; where our own database lives is a separate question (§10).

## 2. Customer and pricing

| | |
|---|---|
| Buyer | Brokerage owner or sales manager (5–100 agents); developer sales/marketing team |
| Pain | Slow first response, agents wasting time on unqualified leads, leads scattered across portals and ads |
| Metrics they care about | % leads answered < 1 min, % qualified, viewings booked, cost per viewing, by source |
| Sales model | Self-serve sign-up. Free public beta in Phase 1; 14-day free trial once paid plans start in Phase 2 |

**Pricing to validate (USD/month, software only, same features with or without AI):**

| Plan | Price | Includes |
|---|---|---|
| Starter | $99 | 5 seats, 300 leads/mo, 200-page knowledge base |
| Growth | $299 | 20 seats, 2,000 leads/mo, CRM sync, 2,000-page knowledge base |
| Scale | $699 | 50 seats (more on request), 10,000 leads/mo, SSO, audit log, 20,000-page knowledge base. Sold once SSO and audit log ship (Phase 3) |
| Overage | $0.10 / lead | |

**What counts as a lead:** a conversation where the person sends at least one message, or a submitted form. The same phone or email counts once per month. Visitors who only open the chat widget don't count, so casual visitors and bots can't use up a plan.

**At launch (Phase 1) the product runs as a free public beta** with the web chat widget and the WhatsApp simulator. Paid plans and billing switch on in Phase 2, when real WhatsApp goes live with the first client.

**What the customer pays elsewhere, directly to each provider:** AI usage (their AI provider), document storage (their own bucket; Cloudflare R2's free tier is usually enough for an agency's brochures), WhatsApp fees (Meta, plus their own WhatsApp provider if they use one), SMS (their Twilio/Unifonic account), email to leads (their email service). The dashboard shows an estimate of their AI cost per lead.

**No pass-through fees on our side:** customers connect their own WhatsApp account (from Meta directly or through their own provider), so any provider fees are between them and that provider.

## 3. Competition and positioning

| Player | What they are | Gap we target |
|---|---|---|
| Tend (CodexaAI) | AI WhatsApp agent + CRM for Dubai brokerages | Replaces the CRM; agencies must switch |
| Ruby CRM | UAE brokerage CRM with AI scoring | CRM-first; AI is a feature |
| Gallabox, Wati (Astra), respond.io | Horizontal WhatsApp platforms with AI agents | Generic; agency builds the real estate logic itself |
| PropBridge and similar | Portal-to-CRM lead connectors | Move leads, don't talk to them |

Competitor details come from vendor pages and listings; check each one's pricing and how they charge for AI during customer calls.

**Our angle:** real-estate-native, useful from day one without AI, fully bring-your-own (AI, WhatsApp, SMS, email and storage on the customer's own accounts, with no markup on any of them), strictly on-topic, plugs into the existing CRM.

## 4. Scope by phase

### Phase 1: launch build (blog post + public demo + free beta)
**Core (no key)**
1. Lead intake: website form/embed, generic webhook, CSV import.
2. Channels: **web chat widget** (real; customers embed it on their site and landing pages, with their own logo, colours, greeting and language) and a **WhatsApp simulator** that behaves like WhatsApp (templates, buttons, lists, 24-hour window).
3. Instant reply within 60 s (immediate in web chat). Leads arriving by form, webhook or CSV show up in the dashboard, but in Phase 1 they can only be messaged in the simulator.
4. Scripted qualification flow with buttons and lists; ready-made English and Arabic flows; simple flow editor; branching. Web chat flows also ask for name and phone/email (with a consent line and privacy link), because web visitors arrive anonymous.
5. Rule-based scoring (hot/warm/cold), routing (round-robin or rules), agent alerts by email (our account email, sent only to the customer's own staff).
6. Viewing/call booking from a slot list. The confirmation is shown in the chat; emails to leads come in Phase 3 through the customer's own email service.
7. Shared inbox with human takeover.
8. Dashboard: leads, per-source funnel, response times, viewings. English and Arabic with right-to-left layout.
9. Project, listing and units config, including price list import from Excel/CSV.

**AI (with a key)**
1. Connections page (§6): connect an AI key (Claude, OpenAI, Gemini certified; any OpenAI-compatible endpoint as best effort) and, for document uploads, the customer's own storage bucket.
2. Conversational qualification in any language; free-text understanding.
3. Knowledge base: typed Q&A pairs, website pages and typed rules work with just the AI key; file uploads also need the customer's storage bucket (§7a).
4. AI lead summary, score explanation, reply suggestions for agents.
5. Topic guard and key protection (§7b).
6. Automatic fallback to the scripted flow when the key fails.

### Phase 2: first paying client
- **Real WhatsApp on the client's own account:** the client connects their own WhatsApp Business credentials, either straight from Meta (WhatsApp Cloud API) or from their own provider account (360dialog first, as its API mirrors Meta's). They pay Meta and their provider directly, and CyphronTech needs no Meta Tech Provider status. Start the client's number setup, Meta business verification and first template approvals on day one; they can take from days to a few weeks.
- Only the lead sources the client actually uses (from Meta Lead Ads, Click-to-WhatsApp ads, TikTok or Google lead forms), connected by signing in to their own ad accounts; the rest follow later.
- Follow-up sequences using approved templates; reminders.
- The client's CRM: native sync only if it's HubSpot or Bitrix24; any other CRM through the outbound webhook (with Zapier or Make) until a native integration is worth building.
- Billing and paid plans through a merchant of record that handles VAT and sales tax worldwide: Paddle, or Stripe Managed Payments (public preview in 2026). Avoid starting new on Lemon Squeezy, which Stripe is moving merchants off. Check the provider accepts sellers from CyphronTech's country of registration.
- Regional hosting if the client requires it.

### Phase 3: growth
- SMS via the customer's Twilio/Unifonic account.
- Email to leads (booking confirmations, reminders, follow-ups) through the customer's own email service (SMTP, Resend, SendGrid).
- Portal integrations (Property Finder, Bayut, Dubizzle) using each customer's own portal API credentials where the portal issues them (otherwise CyphronTech applies as an integration partner); email-parsing inbox meanwhile.
- Optional: become a Meta Tech Provider to offer one-click WhatsApp signup. It's a convenience only; the account and billing stay the customer's.
- Google Drive, Dropbox, OneDrive sync for the knowledge base.
- Azure OpenAI, AWS Bedrock, Google Vertex AI as certified providers.
- More CRMs (Salesforce, Zoho), voice, Instagram/Messenger, white-label for agencies.
- SSO and audit log (promised on the Scale plan).
- Calendar sync (Google/Outlook) for agents' viewing availability.

## 5. How a lead flows

```
Website form / widget / webhook / CSV ──► /api/leads/ingest ──► Lead created, dedupe by phone + email
                                                │
                                                ▼
                       First message ≤ 60 s (web chat now; WhatsApp simulator → real WhatsApp later)
                                                │
              lead replies ──► channel adapter ──► job queue ──► Free checks (opt-out, length, rate, abuse rules)
                                                                    │
                                     Human agent has taken over? ── yes ──► message goes to the inbox only
                                                                    │ no
                                     ┌──── AI on, key OK, lead under budget & strike limit? ────┐
                                     │ yes                                                      │ no
                                     ▼                                                          ▼
                    Scope check ──► AI agent turn (tools)                              Scripted flow step
                    (off topic → free canned reply)                                     (buttons, rules)
                                     │  search_knowledge, search_listings, send_document,       │
                                     │  save_qualification, book_viewing, handoff_to_human      │
                                     ▼                                                          │
                              Reply check ──────────────────────────────┬────────────────────────┘
                                                                        ▼
                                  Score + summary ──► assign agent ──► alert ──► (CRM sync in Phase 2)
```

## 6. Architecture

### BYOK map: what the customer brings vs what we run

| Service | Provided by | Phase |
|---|---|---|
| AI models (chat, document search embeddings, reading scanned pages) | Customer's own key: Claude, OpenAI, Gemini, Azure/Bedrock/Vertex, or a compatible endpoint | 1 |
| Document file storage | Customer's own S3-compatible bucket | 1 |
| WhatsApp | Customer's own WhatsApp Business account (Meta Cloud API, or their own 360dialog account) | 2 |
| Lead ad sources (Meta, TikTok, Google) | Customer's own ad accounts, connected by sign-in | 2 |
| CRM | Customer's own CRM account | 2 |
| SMS | Customer's own Twilio or Unifonic account | 3 |
| Email to leads | Customer's own email service (SMTP, Resend, SendGrid) | 3 |
| Property portals | Customer's own portal API credentials | 3 |
| Calendars, cloud drives | Customer's own Google, Microsoft or Dropbox accounts, connected by sign-in | 3 |
| **The software itself:** hosting, database and search index, job queue, realtime, bot protection, monitoring, account emails to the customer's own staff | CyphronTech, covered by the subscription | Always |

- The no-key tier (web chat + scripted flow) needs no connections at all.
- CyphronTech never pays for or resells AI or messaging in the product. The only AI CyphronTech pays for is development work: testing, model certification and recording the demo conversations.
- **Connections page:** one place listing every connection with a status light, a Test button and a setup guide. Credentials are checked when saved and then regularly.
- **When a connection breaks,** the admin gets an alert by our account email, and the product degrades instead of failing:
  - AI key → scripted flow.
  - Storage bucket → answers still work from the search index; sending a brochure is handed to a human.
  - WhatsApp, SMS or email → messages queue for retry and the admin is alerted immediately; web chat keeps working.

### Stack (cheapest that still works)

| Layer | Choice | Notes |
|---|---|---|
| App | Next.js 16 + React 19 + TypeScript on Vercel | Dashboard, API routes, webhooks; i18n + RTL. Vercel Pro (~$20/mo) because the free plan is non-commercial |
| DB | Postgres + Prisma on Neon | Free/low tier to start; pgvector and full-text search built in. Neon rather than Supabase's free tier, which pauses inactive projects |
| Region | Frankfurt for both the database and Vercel functions | Cheap, close to the Gulf, GDPR-ready. Vercel's default function region is in the US, so set it explicitly or every database call crosses the Atlantic |
| Realtime | Pusher or Ably (free tier) | Vercel functions can't hold WebSocket connections, and the web chat widget and inbox need replies pushed to them as soon as a background job finishes |
| Jobs | Inngest or Upstash QStash (free tiers) | Agent turns, flow steps, ingestion, reminders |
| Rate limits and locks | Upstash Redis (free tier), or Postgres advisory locks | The per-lead lock (one bot turn at a time) and the rate limits in §7b need a shared store, because serverless functions keep no memory between calls |
| Ingestion worker | Vercel functions first; a small container (~$5/mo) if needed | Large PDFs can exceed serverless time and memory limits. Scanned pages are read by the customer's AI model, not on our servers |
| Bot protection | Cloudflare Turnstile (free) | On the web chat widget and the public demo |
| Monitoring | Sentry (free tier) + database backups | Errors in webhooks and jobs are otherwise silent |
| File storage | Customer's own S3-compatible bucket (AWS S3, Cloudflare R2, Backblaze B2, Wasabi and similar) | One S3 client with a custom endpoint covers them all. Files upload straight from the browser to their bucket, because Vercel caps request bodies at 4.5 MB; the connection step sets the bucket's CORS rule when the key allows it. We keep only the extracted text index. Widget logos are small enough for our database; demo files ship with the app |
| Secrets | Envelope encryption (app-level AES with a master key from env/KMS) | Every customer credential: AI and storage keys now; WhatsApp, SMS, email, CRM and portal credentials later. Write-only after saving |
| Auth | Email/password + Google sign-in, org invites, via an open-source auth library | Roles: owner, manager, agent. Avoids paid per-user auth services |
| Account email | Resend or similar (free tier) | Sign-in emails and alerts to the customer's own staff only. Emails to leads always go through the customer's own email service |

**Expected running cost at launch:** roughly $20–50/month, with no AI or messaging spend: customer files sit in their own buckets, and the demo uses recordings or the visitor's own key.

### Channel layer and the WhatsApp mock
- One `Channel` interface: `sendText`, `sendButtons`, `sendList`, `sendTemplate`, `sendDocument`, plus incoming message parsing.
- Adapters: `webchat` (real), `whatsapp-sim` (Phase 1), `whatsapp-cloud` and `whatsapp-360dialog` (Phase 2, on the customer's own credentials), `sms` (Phase 3).
- Each customer's WhatsApp account sends its webhooks to its own URL on our side (one per org), checked with that customer's own credentials (Meta signs webhooks with the app's secret), because every customer brings a different Meta app or provider account.
- **The simulator copies Meta's real rules and payload formats:** max 3 reply buttons, max 10 list rows, short character limits on button and row titles (check Arabic labels fit), only approved templates once the 24-hour window has closed, webhook payloads in Meta's JSON shape. Switching to real WhatsApp should then mostly mean swapping the adapter and connecting the customer's own credentials.
- Simulator UI: a chat-app-style phone view in the dashboard and the public demo, labelled as a simulation, without WhatsApp's logo or branding.

### AI provider layer
| Provider type | Examples | Support level |
|---|---|---|
| Native | Anthropic Claude, OpenAI, Google Gemini | **Certified** in Phase 1 |
| Cloud-hosted | Azure OpenAI, AWS Bedrock, Google Vertex AI | Certified in Phase 3 |
| Compatible endpoint | Any OpenAI-compatible API: self-hosted (vLLM, Ollama), OpenRouter, Groq and others | Best effort, must pass our compatibility check |

- **Build choice:** a multi-provider TypeScript library (for example the Vercel AI SDK) is the faster route for a solo developer; own adapters on official SDKs give tighter control. Either way the app talks to one interface: `runAgentTurn(conversation, tools) → messages + tool calls + token usage`, plus `embed(texts)` where the provider supports it.
- **Connect-a-key flow:** provider → key (or endpoint + key) → model → test call + compatibility check (tool calling, JSON output, Arabic reply, embeddings available?) → pass/fail and estimated cost per lead.
- **Customer controls:** monthly AI spend cap, per-lead token budget, which AI features are on. Key guides tell customers to create a dedicated key and set a spending limit at their provider where one is offered (for example Anthropic workspace limits). Some providers only send alerts, so our own caps must be enforced on the server, not just displayed.
- **Usage visibility:** every AI call logged with tokens; converted to estimated cost from a price table (certified models) or prices the customer enters.

**Provider quirks the layer must handle** (checked against Anthropic's current API docs; OpenAI and Gemini get the same review during certification):
- **Conversation history must be append-only, stored exactly as the provider returned it.** Current Claude models (Opus 5.5, Sonnet 5.5) return thinking blocks that must be passed back unchanged, and for Anthropic accounts created on or after 31 Aug 2026 the API rejects a request if the system prompt, tool list or any earlier message changed since those blocks were produced. With BYOK, many customers will have such new accounts. So:
  - Freeze the system prompt and tool list per conversation. If the customer edits rules documents or project data mid-conversation, add the change as a new system message at the end instead of rewriting the original.
  - Never edit or trim stored AI replies. If the reply check blocks a reply, discard the whole turn and regenerate; don't save a modified version.
  - Store each provider's raw response blocks, not just the text.
  - Messages a human agent types during a takeover, and scripted-flow messages after a fallback, are added as new turns at the end, never slotted into earlier ones.
- **No forced tool choice:** Claude Opus 5.5 and Sonnet 5.5 reject "must call a tool" settings. Use automatic tool choice with strict schemas, or structured output.
- **No sampling settings:** these models reject custom temperature/top-p values, so don't send them.
- **Thinking can't be fully switched off** on Claude Opus 5.5; use the lowest effort setting for fast chat replies.
- **Refusals:** Claude's safety classifiers can occasionally decline a harmless request (`stop_reason: "refusal"`). Treat it like a failed turn: the scripted flow or a human handles that message.
- **Prompt caching differs by provider** (explicit on Claude, automatic on OpenAI, varies elsewhere; often none on custom endpoints). Cost estimates must assume no caching unless the provider supports it.
- **Claude's default cache lasts 5 minutes.** Leads often reply slower than that, and then every turn pays full input price. Use Claude's 1-hour cache option (costs more to write, pays off when replies come 5–60 minutes apart); the cost table in §7 shows both cases.
- If using a multi-provider library, **test that it passes Claude thinking blocks back unchanged, supports the cache options above, and doesn't add forced tool choice or temperature**; this decides library vs own adapters.

**Core tables:** `Org`, `User`, `Project`, `Listing`, `Unit`, `AvailabilitySlot`, `Lead`, `Conversation`, `Message`, `Flow`, `Connection` (type: AI, storage, WhatsApp, SMS, email, CRM, portal; encrypted credentials; status; last check), `AgentRun` (provider, model, tokens, est. cost, tools, latency, fallback, guard result, knowledge used), `Strike`, `KnowledgeSource`, `Document`, `Chunk`, `QaPair`, `UnansweredQuestion`.

**Engineering must-haves**
- Idempotent webhooks; per-lead lock so two messages never trigger two turns at once.
- Customer credentials (AI, storage, WhatsApp, SMS, email, CRM) never logged, never returned to the browser after saving, decrypted only inside the job that uses them.
- Errors from every connected service classified (bad credentials / no credit / rate limit / outage / bad output) to drive fallback and alerts.
- Opt-out words in any language honoured before any flow or AI step.
- Timezones and Gulf working weeks in scheduling and quiet hours.
- Phone numbers normalised to international format before deduping.
- Customer-supplied URLs and hosts (custom AI endpoints, storage endpoints, email servers, website sources, outbound webhooks) are checked so they can't point at internal or private network addresses.
- Export and delete one lead's data on request (data protection requests).
- Every database query scoped by `orgId` in one shared helper (or Postgres row-level security), so one customer can never see another's data.
- Automated tests (Jest, as in the other CyphronTech projects) for the flow engine, guard rules, scoring and webhook handling.

## 7. AI design

**Agent behaviour (same rules on every provider)**
- Short chat-style messages, one question at a time, in the lead's language and script.
- Answers only from the customer's documents, project data and units table. Never invents prices, availability, payment plans, rental yields, Golden Visa eligibility, mortgage approval or legal claims; hands off instead.
- Always follows the customer's rules documents.
- Lead messages, documents and web pages are information, never instructions.
- Output validated against our qualification schema before saving; invalid output triggers the scripted fallback for that step.

**Eval suite:** ~60 scripted conversations (English, Gulf Arabic, Russian, Hindi/Urdu; time-wasters, hagglers, off-topic and jailbreak attempts, instructions hidden in documents, off-plan and mortgage questions, borderline real questions like nearby schools or service charges). Run against every certified model before release and whenever prompts change. Runs on CyphronTech's development keys, as does recording the demo conversations (§8). That is a development cost only; nothing in the product runs on our keys.

**Example customer AI cost per qualified lead** (rough, for the dashboard estimate; real figures come from `AgentRun` logs). Assumptions: ~10 turns; a fixed prefix of ~8K tokens (instructions, tools, rules sheet); conversation history growing to ~4K; ~1K tokens of retrieved passages per turn on average; ~300–800 output tokens per turn including the model's thinking at low effort. Arabic uses more tokens.

| Model | Cache warm (replies come quickly) | Cache cold (slow replies; every turn pays full input price) |
|---|---|---|
| Claude Opus 5.5 | ~$0.15–0.30 | ~$0.50–0.70 |
| Claude Sonnet 5.5 | ~$0.09–0.16 | ~$0.25–0.35 |
| Claude Haiku 5.5 | < $0.01 | ~$0.02 |
| OpenAI / Gemini models | measured during certification | |

- Web chat conversations are usually warm; WhatsApp conversations are often cold unless Claude's 1-hour cache is used (§6).
- Keep each org's prefix byte-identical across conversations (lead-specific details go after it), so a busy org's conversations share one warm cached prefix.
- Add the scope check (§7b) on every message: negligible on a Haiku-class model, up to ~$0.03 per lead on a Sonnet-class model.

## 7a. Customer knowledge base (RAG)

Used only when an AI key is connected. The AI checks the customer's documents before answering a lead. Original files live in the customer's own storage bucket; we keep only the extracted text index.

**Sources:** in Phase 1, file uploads (PDF, Word, Excel/CSV, images; need the customer's bucket), plus typed Q&A pairs and website pages (no bucket needed). In Phase 3, files read straight from the customer's own Google Drive, Dropbox or OneDrive. Every source is tagged to the whole org or to specific projects.

**Two kinds of documents**

| Kind | Examples | How the AI uses it |
|---|---|---|
| **Rules documents** | Terms and conditions, privacy notice, disclaimers, "what we never say" lists, tone of voice | Applied to **every** AI reply (kept in the cached part of every request). Size-capped (e.g. ~10 pages in total): they are sent with every message, so a 40-page T&C would multiply the customer's AI cost, especially on providers without caching. Long documents are condensed into a short rules sheet (using the customer's key) that the admin reviews and approves |
| **Reference documents** | Brochures, payment plans, FAQs, website pages, Q&A pairs | Searched when a question needs them |

Rules documents come from the customer's admin, so they count as the customer's instructions, but they can only make the AI stricter, never widen what it may talk about. Reference documents and web pages are information only.

**Ingestion (background jobs)**
1. Files upload straight from the browser into the customer's bucket, and the ingestion job reads them from there. Enforce size and page limits and basic file-type checks. The website fetcher only crawls public pages on domains the customer lists, respects robots.txt, and caps pages per crawl.
2. Extract text with standard PDF/Word parsers. Scanned pages and images are read by the customer's AI model (their cost; every certified model can read images). If their model can't, the file is flagged so they can upload a text version. No AI runs on our servers.
3. **Price lists are not chunked:** spreadsheets of units, prices and availability go through the same importer as the units config (§4, Core item 9) into the `Unit` table, and are queried exactly by `search_listings`. Other spreadsheets (an FAQ kept in Excel, for example) are turned into text and searched like documents.
4. Split into chunks that keep headings and page numbers; store with a full-text index.
5. If the customer's provider offers embeddings, embed the chunks with their key.
6. Show status per source: processing, ready, failed (with reason), last synced, and a preview of the extracted text.

**Search with no AI cost to us**

| Customer's key | How search works |
|---|---|
| Provider with embeddings (OpenAI, Gemini, Azure, Bedrock, Vertex, some compatible endpoints) | Hybrid search: meaning (embeddings with their key) + keywords |
| No embeddings (Claude-only, many custom endpoints) | Keyword search (Postgres full-text + fuzzy matching for Arabic and typos). The AI first rewrites the lead's question into search keywords in the document's language, using the customer's own key |
| Provider with prompt caching, small knowledge base (a few brochures per project) | Skip search: include the project's documents directly in the cached prompt. Simpler and often more accurate. Only when the cache is likely to stay warm (web chat, busy orgs) or on a cheap model; never on providers without caching. With slow WhatsApp replies a prompt carrying several brochures gets expensive on every turn |

- Embeddings are tagged with provider and model; if the customer switches provider, a re-index job runs on their new key (cost shown first).
- Providers produce embeddings of different sizes, and pgvector indexes need one fixed size per column (max 2,000 for the standard vector index). Request a fixed size where the provider allows it (OpenAI and Gemini do), otherwise keep a column per size. Prisma has no vector type, so vector queries use raw SQL.
- Check Arabic quality of Postgres full-text search early; fall back to trigram matching if stemming is weak.

**Answering:** `search_knowledge(question, project)` → top passages (Q&A pairs first) → answer only from them → hand off if nothing relevant. `send_document` sends the original brochure or floor plan from the customer's bucket (as a short-lived link, or uploaded to the chat channel). The inbox shows which documents and pages each answer used.

**Keeping answers correct:** valid-until dates and priorities on documents; conflicts flagged; unanswered-questions report; a test playground showing the answer and the passages behind it.

**Plan limits (to validate):** Starter 200 pages · Growth 2,000 pages · Scale 20,000 pages. These limit our text index; the files themselves sit in the customer's bucket.

## 7b. Staying on topic and protecting the customer's AI key

The customer pays for every token, so the AI must only be used for their leads and their business, and no one should be able to use it as a free general chatbot or drain their credit.

1. **Free checks before any AI call:** message length cap (e.g. 1,000 characters), rate limits per lead and per org, pattern rules for obvious abuse (code blocks, "ignore previous instructions", role-play requests, huge pastes), blocked numbers, bot protection on the web widget.
2. **Scope check:** a short, cheap check with the customer's fastest model labels each message (on topic, small talk, off topic, abuse). Off-topic messages get a fixed, free reply that steers back to the property question; they never reach the full agent. It adds a second AI call per message (about half a second to a second, and a small cost; see the note under the cost table in §7). The customer picks a small, cheap model for it when connecting their key (default: the provider's smallest certified model). Customers can turn it off, in which case the main agent classifies the message itself through a `decline_off_topic` tool.
3. **A narrow agent:** the system prompt lists exactly what it may discuss; its only abilities are our tools (no browsing, no code, no general tools); low output-token cap for WhatsApp-length replies.
4. **Reply check before sending (free rules):** blocked if too long, contains code, has links or phone numbers not on the customer's allow-list, or quotes a price that isn't in the units table or the document passages used for that answer (numbers normalised first, including Arabic-Indic digits and formats like "1.2M"). Then discard and regenerate once, or hand off. Whether a reply is on topic can't be judged reliably by free rules; that is layers 2 and 3's job.

**Strikes and budgets:** each clear abuse attempt (jailbreaks, code, huge pastes, role-play requests) is a strike. Ordinary off-topic questions are only steered back, and count as a strike only after several in a row (e.g. 5). After 3 strikes (configurable), the AI stops for that lead and the scripted flow or a human takes over. Token budgets per lead and per month; when hit, the scripted flow takes over and the admin is told.

**Visibility:** abuse dashboard (flagged conversations, strikes, blocked numbers, top token-using leads) and AI spend by day, source and project.

## 8. The public demo build

Fully BYOK too: the demo never runs AI on CyphronTech's key.

1. Visitor fills a fake ad form for "Marina Crest, off-plan 1–3 BR, Dubai Marina". The demo org has a sample brochure, payment plan, FAQ and terms loaded.
2. The WhatsApp-style simulator opens. The same bot is also available as a website chat widget, which is what beta users actually get in Phase 1.
3. **Scripted mode** runs live for everyone; no key involved.
4. **AI mode, recorded:** real AI conversations recorded during development replay in the simulator, with the dashboard updating alongside: English, Arabic and Russian buyers, questions answered from the brochure, a booked viewing, and "try to break it" attempts being declined while the strike counter rises.
5. **AI mode, live with your own key:** a visitor can paste their own AI key to chat with the AI live. The key is used only for that demo session, kept in memory, never stored or logged, with a clear notice next to the field; the same topic guard and limits apply.
6. Split screen: the agency dashboard shows score, summary, assigned agent and booked viewing.

Guardrails: rate limit per IP, bot protection, demo org reset nightly, demo data deleted after 24 h. Recordings are re-made whenever prompts change, so they always match the real product.

## 9. Milestones

### Phase 1: solo with Claude Code (~12 weeks)

| Week | Deliverable |
|---|---|
| 1 | Repo, auth, orgs, i18n/RTL shell, Prisma schema, project/listing/units config with Excel/CSV import |
| 2 | Channel layer, web chat widget with realtime updates, WhatsApp simulator (Meta-shaped payloads and rules), lead ingest (form, webhook, CSV) |
| 3 | Scripted flow engine, default English/Arabic flows, flow editor, rule scoring |
| 4 | Routing, email alerts, booking slots, shared inbox with takeover |
| 5 | AI provider layer (Claude, OpenAI, Gemini, compatible endpoints), Connections page and credential vault, connect-a-key flow, automatic fallback |
| 6 | AI agent: prompts, tools, schema validation, multilingual behaviour |
| 7 | Topic guard (all four layers), strikes, token budgets; eval suite v1 across certified models |
| 8 | Knowledge base: storage-bucket connection with direct browser uploads, Q&A pairs, rules documents, extraction, keyword + customer-key embedding search, `search_knowledge` / `send_document` |
| 9 | Website pages source, test playground, unanswered-questions report; knowledge and abuse eval cases |
| 10 | Dashboard reports, AI cost view, abuse dashboard |
| 11 | Public demo (recorded AI conversations + live "use your own key" mode), landing page (English + Arabic), setup guides for each connection (AI key, storage bucket), security pass, terms of service + privacy policy + data processing terms (needed before real leads' data goes through the beta) |
| 12 | Free beta testers, fixes, launch blog post |

Customer conversations with Dubai/Riyadh brokerages run alongside the build (a few calls a week), to check how fast they answer leads today, which lead sources and CRM they use, pricing, the fully-BYOK idea (will they connect their own AI key, storage bucket and WhatsApp account?) and the documents they'd upload, and to find the first paying client.

### Phase 2: first paying client (~4–6 weeks once signed)
Real WhatsApp on the client's own account, from Meta or their own 360dialog account (number setup and approvals started on day one), the lead sources and CRM that client uses, follow-up templates, billing, regional hosting if required.

### Phase 3: growth
SMS, email to leads, portals and cloud drives (all on the customer's own accounts), more certified providers and CRMs.

## 10. Compliance and regional rules

| Area | What it means for us |
|---|---|
| **Customer-owned services** | Conversations, document passages, messages and files go through the AI, WhatsApp, SMS, email and storage accounts the customer connected, under the customer's own contracts with those providers (including Meta's WhatsApp Business policies). Our terms must say clearly that the customer is the account holder and we act as their software |
| **Telling leads it's a bot** | The default greeting says it's an automated assistant and offers a human. Good practice everywhere, and the EU AI Act requires chatbots to disclose that they're AI (relevant for the European expansion) |
| **Customer documents** | Customers confirm they have the right to use what they upload; deleting a source deletes our text index and embeddings, and the files we put in their bucket |
| **Hosting** | Frankfurt for the beta (cheap, close to the Gulf, GDPR-ready). Documents sit in the customer's own bucket in a region they choose, and AI processing happens at their provider; our database holds conversations, settings and the text index. Move or add a regional database (UAE, Saudi, EU) when a paying customer requires it, so keep data access behind one layer to make that possible |
| **UAE data protection (PDPL)** | Consent and data subject rights; get local advice before taking paying UAE customers |
| **Saudi data protection (PDPL / SDAIA)** | Transfers outside the Kingdom need a permitted basis and safeguards; a Saudi customer may require in-Kingdom hosting |
| **Dubai property advertising (DLD/RERA)** | Ads need a Trakheesi permit number; brokers need Form A; agent repeats only approved facts |
| **Saudi real estate (REGA)** | Licensed brokers (FAL); same rule |
| **WhatsApp (Phase 2)** | On the customer's own account, so template approvals and Meta policy compliance are theirs; we honour opt-outs and keep the AI scoped to the business |
| **SMS (Phase 3)** | UAE: registered "AD-" sender IDs, consent upload, no promotional sends 9pm–7am. Saudi: sender names registered through a licensed provider |

## 11. Launch blog post

**Working title:** "No markup, your own accounts: a lead bot for Dubai real estate that works without AI and gets smarter with your own key"

1. The problem: unanswered and cold leads, and what they cost an agency.
2. Two tiers: the normal bot vs. the AI bot with your key (side-by-side GIF), including answers straight from the developer's brochure.
3. Why fully BYOK: your own AI, WhatsApp, SMS, email and storage accounts; we charge only for the software; transparent costs, and your data stays in your own accounts.
4. Keeping your key safe: how a lead can't turn the bot into a free ChatGPT (with real attempts from the demo).
5. How it works: one engine, many providers; evals; automatic fallback.
6. Hard parts: same behaviour across Claude, GPT and Gemini; Arabic; document search without paying for embeddings; building a faithful WhatsApp simulator.
7. What a qualified lead costs on different models, and why slow replies cost more (caching).
8. Try the demo (recorded AI runs, or live with your own key), join the beta.

## 12. Expansion path after the Gulf

1. Rest of GCC. 2. UK and Europe. 3. US and Canada (SMS-first). 4. Second vertical on the same engine.

## 13. Risks

| Risk | Mitigation |
|---|---|
| Solo build takes longer than planned | Phased scope. If late, cut in this order: website pages source → visual flow editor (edit flows as simple forms instead) → Arabic dashboard UI (keep Arabic bot conversations, English dashboard) → abuse dashboard (keep a plain flagged-chats list) |
| Phase 1 beta gives limited value: only web chat leads can be messaged | Pitch the beta as "AI chat agent for your website" plus the WhatsApp demo; real WhatsApp starts with the first paying client |
| Customers on new Anthropic accounts get errors if conversation history is edited | Append-only history with raw provider blocks; frozen system prompt per conversation; eval runs on a newly created Anthropic account |
| WhatsApp simulator differs from the real API | Copy Meta's payload formats and limits exactly; test against Meta's test number before the first client |
| Fully BYOK means several setups (AI key, storage bucket, later their own WhatsApp account), and small brokerages may not know how | The no-key tier needs zero connections; a setup checklist with step-by-step guides per provider; clear connection checks; Cloudflare R2's free tier keeps storage free for most; optional paid setup help from CyphronTech (an extra revenue line) |
| A customer's own WhatsApp, SMS or email account breaks (expired token, unpaid bill, blocked number) and leads go unanswered | Regular health checks, instant admin alerts, retry queue; web chat unaffected (§6) |
| Visitors paste their own keys into the public demo | Used in memory for that session only, never stored or logged; clear notice next to the field |
| Weak search for customers without embeddings | Keyword search + AI keyword rewriting + small knowledge bases loaded directly into the prompt where caching keeps that affordable; measure in evals |
| Customers' AI bills come in higher than our estimate because slow replies let the cache expire | Claude's 1-hour cache; one shared prefix per org; real cost per lead shown from logs; suggest smaller models for chat |
| Customer-supplied URLs used to reach internal systems | URL checks block private and internal addresses (§6) |
| AI quality varies by provider | Certified models, compatibility check, schema validation, scripted fallback |
| Leads misuse the bot or drain the customer's credit | Four-layer topic guard, strikes, token budgets, abuse dashboard |
| Topic guard blocks real buyers | Steer back instead of ending chats; strikes mainly for clear abuse (plain off-topic questions count only after several in a row); borderline cases in evals |
| Outdated prices from old brochures | Prices only from the units table; valid-until dates; conflicts flagged |
| Instructions hidden in documents or web pages | Treated as information only; eval cases with poisoned documents |
| Storing many customer credentials (AI, storage, WhatsApp, SMS, email) | Encrypted, write-only, never logged, minimal access, easy rotation from the Connections page |
| No paying client yet when the beta launches | Customer calls alongside the build; Phase 2 ready to start the week a client signs |

## 14. Decisions still open

1. Product name and global domain ("LeadSprint" is only a placeholder; check the final name isn't already another product's name or trademark).
2. Where the blog post is published (CyphronTech site, Medium/dev.to, LinkedIn, or all).
3. Provider layer: multi-provider library vs own adapters. The library is faster for a solo build, but only if it passes the provider-quirks test in §6.
4. Which exact models to certify at launch.
5. Who the first beta testers and potential paying clients are.
6. Billing provider for Phase 2: Paddle or Stripe Managed Payments (depends on where CyphronTech is registered).

**Settled**
- Phase 1 stays web chat + WhatsApp simulator only; real WhatsApp waits for the first paying client (Phase 2).
- Fully BYOK: AI, WhatsApp, SMS, email to leads and document storage all run on the customer's own accounts. CyphronTech pays for no AI or messaging in the product; the demo uses recordings plus the visitor's own key.
