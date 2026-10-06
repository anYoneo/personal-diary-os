# Architecture

## 1. Assessment before building

The repository was empty apart from a fresh `create-next-app` scaffold — no pre-existing
infrastructure to preserve, so the stack was chosen for this product rather than inherited:
TypeScript, Next.js App Router, Tailwind, Prisma + SQLite, Vitest. No microservices: a diary is
one user, one database, and bounded work. Splitting it would add deployment surface and buy nothing.

## 2. Shape

Modular monolith with three entry points sharing one service layer:

```
src/app/**          web pages (RSC) + REST API routes
src/discord/**      bot process and/or HTTP interactions
src/worker/**       scheduled work
src/lib/services/** ← the only place that touches the database
src/lib/**          db, auth, crypto, day/timezone, markdown, validation, errors
```

Rules that keep it honest:

- **Services own the data.** API routes validate input, call a service, and shape a response; they
  never compose Prisma queries for their own needs.
- **Discord is a client, not a subsystem.** `src/discord/*` calls the same `createEntry`,
  `searchEntries`, `memoryDigest` that pages call. Capturing an entry from Discord exercises exactly
  the same code path as writing it on the web, so neither can drift.
- **Outbound messages are queued, not sent inline.** Saving an entry writes an
  `NotificationOutbox` row inside the same transaction. The worker delivers it later. A Discord
  outage cannot fail a diary save, and undelivered messages survive a restart.

## 3. Data model

```
User ─┬─ Session
      ├─ UserSettings
      ├─ DiscordLink ── LinkCode
      ├─ Tag ── EntryTag ──┐
      ├─ LifeThread ─ EntryThread ─┤
      ├─ Goal ────────────────────┴─ Entry ─┬─ Attachment
      ├─ UnresolvedThought                   ├─ AiInsight
      ├─ Reminder                            └─ EntryEntity ── Entity
      ├─ NotificationOutbox
      └─ AuditLog
```

| Decision | Why |
| --- | --- |
| `Entry.day CHAR(10)` indexed, in the *owner's* timezone | Streaks, timeline grouping, on-this-day and analytics are all "bucket by local day". Doing that in SQL across timezones is where diary apps quietly break; storing it makes every one of those queries an index range scan. Recomputed on write and on timezone change. |
| Soft delete everywhere an entry is involved | Losing writing is the one unrecoverable failure. Trash + explicit audited purge instead of `DELETE`. |
| `AiInsight` is chat-shaped (`role`, `kind`, `content`) not columns on `Entry` | Guarantees the AI cannot rewrite the original, and lets insights accumulate per entry. Rendered in a labelled block under the original text. |
| `NotificationOutbox` with `status`, `attempts`, `lastError` | Retry + observability for free, and lets the settings page tell the truth about what was delivered. |
| `Entity` / `EntryEntity` created but not populated | The memory-graph capability the spec asks for needs a place to land. Today nothing writes them; `lifeThreads` is computed from tags you actually used, so no invented structure appears in the UI. |
| `ParentId` self-relation on `Entry` | Enables the "entry A → follow-up entry B" link the memory graph needs, without a separate join table. |
| Every list query filters `userId` | There is no query in the codebase that reads entries without an owner predicate. |

## 4. Discord architecture

Two modes, one behaviour:

- **Gateway** (`npm run bot`) — a long-lived `discord.js` client. Slash commands *and* DM capture.
  This is the mode to use locally.
- **HTTP interactions** (`POST /api/discord/interactions`) — used when `DISCORD_PUBLIC_KEY` is set;
  the same command router runs behind signature verification.

Events flow one way, outward through the outbox:

```
entry saved ──► NotificationOutbox(pending)
                     │
              worker tick ──► deliver ──► Discord   (success → sent)
                          └──► fail     ──► attempts++, lastError (retry with backoff)
          Discord unconfigured ──► status=skipped  (surfaced in settings, not hidden)
```

```
DM / slash command ──► DiscordLink lookup (unlinked ⇒ refuse)
                   ──► capture.parse() — pure, testable
                   ──► services.createEntry() ← same path as the web editor
                   ──► confirmation embed
```

The parse step is a pure function (`src/lib/services/capture.ts`) so prefix handling, tag extraction
and mood detection are unit-tested without a bot connection.

## 5. AI seam

`src/lib/services/ai.ts` is a thin client for any OpenAI-compatible endpoint. With `AI_BASE_URL`
unset, every call returns `{ available: false, reason }` and the UI shows that instead of a spinner
that never resolves. When configured, the strip-facts/ask-model/store-insight flow is:
facts are computed by SQL, the model receives them, and its answer is written to `AiInsight` — never
to `Entry`.

## 6. Risks and decisions taken deliberately

| Risk | Mitigation |
| --- | --- |
| Autosave losing text on flaky network | Client queues the latest payload, retries, shows `Offline`/`Syncing`; the server recomputes word count/excerpt so a partial client can't corrupt derived fields. |
| Discord as a write path into a private diary | Explicit one-time link code, per-Discord-user resolution, and a refusal to capture from unlinked accounts. |
| SQLite write contention (web + bot + worker) | All three share one file; writes are short and single-user. For anything heavier, switch the provider to Postgres — no schema changes needed. |
| AI leaking diary text to a third party | Off by default, explicit user action per request, endpoint and provider are user-configured. |
| Secrets in git | `.env*` ignored with `!.env.example`; DB file and uploads ignored; no secret is read at build time. |

## 7. Roadmap position

Phases 1–9 of the spec are implemented except where the spec itself defers to later work:
embeddings/vector search (the seam is `Entity`/`EntryEntity` + `AiInsight`), automatic topic
extraction (deliberately not faked), and file uploads (attachments are modelled; the upload endpoint
is the next increment).
