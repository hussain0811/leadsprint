# LeadSprint (working name)

AI lead-qualifying agent for real estate, built by CyphronTech. Fully bring-your-own-key: customers pay for the software and connect their own AI, storage and messaging accounts. Without an AI key it runs as a scripted, button-based bot.

The product plan lives in [docs/PLAN.md](docs/PLAN.md).

## Local build

This is the local test build: SQLite database, local-folder file storage, a WhatsApp-style chat simulator, and AI through any OpenAI-compatible endpoint (for example LM Studio on `localhost:1234`). There is no login; it runs as a single local admin.

### Requirements

- Node.js 22 or newer (developed on Node 24)
- npm 11

### Setup

```bash
npm install
cp .env.example .env
```

Then set `APP_ENCRYPTION_KEY` in `.env` (the file explains how to generate one), and create and seed the database:

```bash
npm run setup
```

### Run

```bash
npm run dev
```

Open http://127.0.0.1:3020. The dev server only listens on this computer, because the local build has no sign-in.

### Connect a local AI model

1. In LM Studio, load a chat model (and optionally an embedding model) and start the server in the Developer tab.
2. In LeadSprint, open **Connections**, keep **LM Studio on this computer**, click **Load models**, then **Save connection** and **Test connection**.

The test runs a reply, tool calling, JSON, Arabic and embeddings check. Models that think before answering (for example `qwen3.5-9b`) can take a minute per reply and may run out of room on the JSON check; for live chat, prefer an instruct model without thinking, or turn thinking off in the server if the model allows it.

For document search by meaning, choose a multilingual embedding model (for example multilingual-e5 or bge-m3). English-only models such as `nomic-embed-text` can't match an Arabic question to an English document; keyword search and Arabic Q&A pairs still work.

### Useful scripts

| Script | What it does |
|---|---|
| `npm run dev` | Start the dev server on port 3020 |
| `npm run setup` | Create the database and load demo data |
| `npm run db:reset` | Wipe the database and reload demo data |
| `npm run db:push` | Apply schema changes and regenerate the Prisma client |
| `npm run lint` | Run ESLint |
| `npm test` | Run unit tests |

### Notes

- npm 11 only runs install scripts for packages listed under `allowScripts` in `package.json`. `better-sqlite3`, Prisma and `esbuild` are approved there; if npm warns about a new one, review it with `npm install-scripts ls`.
- Local data lives in `data/` (database) and `storage/` (uploaded files). Both are git-ignored.
- This project uses Next.js 16 with Cache Components. Read `AGENTS.md` before changing framework code.
