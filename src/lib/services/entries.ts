import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../db";
import { notFound, conflict } from "../errors";
import { audit } from "../audit";
import { countWords, excerpt, titleOrExcerpt } from "../markdown";
import { TIMEZONE, dayKey } from "../day";
import type { entryQuerySchema } from "../validation";
import type { z } from "zod";
import { enqueueEntryCreated } from "./notifications";
import { withLock } from "../mutex";

/**
 * The owner's email, for the Discord-delivery gate.
 *
 * A lookup rather than a parameter so the many call sites of createEntry (web
 * route, Discord capture, tests) do not have to thread it through. One indexed
 * read on a hot path is a fair trade for not sprinkling the gate everywhere.
 * Returns "" if the user vanished, which the gate treats as "not the operator"
 * — failing closed, so nothing is delivered on an unexpected state.
 */
async function entryOwnerEmail(userId: string): Promise<string> {
  const owner = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return owner?.email ?? "";
}

type EntryQuery = z.infer<typeof entryQuerySchema>;

/** Looser than the HTTP schema: the Discord capture path calls this directly. */
export type CreateEntryInput = {
  content: string;
  title?: string | null;
  entryType?: string;
  mood?: string | null;
  occurredAt?: Date;
  location?: string | null;
  isImportant?: boolean;
  tags?: string[];
  threadIds?: string[];
  source?: string;
  sourceRef?: string | null;
  dedupeBySourceRef?: boolean;
};

export type EntryWithRelations = Prisma.EntryGetPayload<{
  include: {
    tags: { include: { tag: true } };
    threads: { include: { thread: true } };
  };
}>;

const entryInclude = {
  tags: { include: { tag: true } },
  threads: { include: { thread: true } },
} satisfies Prisma.EntryInclude;

export function slugifyTag(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

/** All entry reads go through here so soft-deleted rows stay invisible by default. */
function visibility(trash?: boolean): Prisma.EntryWhereInput {
  return trash ? { deletedAt: { not: null } } : { deletedAt: null };
}

export async function createEntry(
  userId: string,
  timezone: string,
  input: CreateEntryInput,
): Promise<EntryWithRelations> {
  const occurredAt = input.occurredAt ?? new Date();
  const day = dayKey(occurredAt, timezone);

  if (input.dedupeBySourceRef && input.sourceRef) {
    const existing = await prisma.entry.findFirst({
      where: { userId, sourceRef: input.sourceRef },
      include: entryInclude,
    });
    if (existing) return existing;
  }

  const tagSlugs = [...new Set((input.tags ?? []).map(slugifyTag).filter(Boolean))];
  const threadIds = [...new Set(input.threadIds ?? [])];

  const entry = await prisma.$transaction(async (tx) => {
    const created = await tx.entry.create({
      data: {
        userId,
        title: input.title?.trim() || null,
        content: input.content,
        entryType: input.entryType ?? "daily",
        mood: input.mood ?? null,
        occurredAt,
        day,
        location: input.location?.trim() || null,
        isImportant: input.isImportant ?? false,
        source: input.source ?? "web",
        sourceRef: input.sourceRef ?? null,
        wordCount: countWords(input.content),
      },
    });

    if (tagSlugs.length) {
      await attachTags(tx, userId, created.id, tagSlugs);
    }
    if (threadIds.length) {
      await attachThreads(tx, userId, created.id, threadIds);
    }

    return tx.entry.findUniqueOrThrow({
      where: { id: created.id },
      include: entryInclude,
    });
  });

  await enqueueEntryCreated(userId, entry, { email: await entryOwnerEmail(userId) });
  return entry;
}

export async function updateEntry(
  userId: string,
  id: string,
  input: Prisma.EntryUpdateInput & {
    tags?: string[];
    threadIds?: string[];
    expectedVersion?: number;
    /** Owner's timezone, so the day bucket follows them and not the server. */
    timezone?: string;
  },
): Promise<EntryWithRelations> {
  // Serialise per entry, in this process.
  //
  // The atomic WHERE-version check below is necessary but was not sufficient:
  // two interactive Prisma transactions against SQLite each evaluated their own
  // snapshot, so two simultaneous saves both matched and both applied (measured
  // against this very service: 200 + 200, the row landing at version 3). Holding
  // a keyed lock across read-check-write closes that completely here, because a
  // single web process serves every request. The database-level guard stays as
  // the backstop for the worker and bot, which do not share this lock.
  return withLock(`entry:${id}`, async () => {
    const current = await prisma.entry.findFirst({ where: { id, userId, deletedAt: null } });
    if (!current) throw notFound("Entry not found");

    const { tags, threadIds, expectedVersion, timezone, ...rest } = input;

    // Optimistic concurrency, enforced atomically.
    //
    // This began as a plain `if (expectedVersion !== current.version) throw` — a
    // read-then-write, which could not see a competing save. The version now also
    // goes into the UPDATE's WHERE, making it a single statement: the loser
    // matches zero rows and the server says so. Prisma's `update` only accepts
    // unique filters, hence `updateMany`.
    if (expectedVersion !== undefined && expectedVersion !== current.version) {
      throw conflict(
        "This entry changed since you opened it. Reload to see the latest version before saving.",
      );
    }

    return prisma.$transaction(async (tx) => {
      const data: Prisma.EntryUpdateInput = { ...rest, version: { increment: 1 } };
      if (typeof rest.content === "string") {
        data.wordCount = countWords(rest.content);
      }
      if (rest.occurredAt instanceof Date) {
        data.day = dayKey(rest.occurredAt, timezone ?? TIMEZONE);
      }

      if (expectedVersion !== undefined) {
        const applied = await tx.entry.updateMany({
          where: { id, userId, version: expectedVersion, deletedAt: null },
          data,
        });
        // Lost the race: something committed between the read and this write.
        if (applied.count === 0) {
          throw conflict(
            "This entry changed since you opened it. Reload to see the latest version before saving.",
          );
        }
      } else {
        await tx.entry.updateMany({ where: { id, userId, deletedAt: null }, data });
      }

      if (tags) {
        const slugs = [...new Set(tags.map(slugifyTag).filter(Boolean))];
        await tx.entryTag.deleteMany({ where: { entryId: id } });
        if (slugs.length) await attachTags(tx, userId, id, slugs);
      }
      if (threadIds) {
        await tx.entryThread.deleteMany({ where: { entryId: id } });
        if (threadIds.length) await attachThreads(tx, userId, id, threadIds);
      }

      return tx.entry.findUniqueOrThrow({ where: { id }, include: entryInclude });
    });
  });
}

async function attachTags(
  tx: Prisma.TransactionClient | PrismaClient,
  userId: string,
  entryId: string,
  slugs: string[],
): Promise<void> {
  for (const slug of slugs) {
    const tag = await tx.tag.upsert({
      where: { userId_slug: { userId, slug } },
      create: { userId, slug, name: slug.replace(/-/g, " ") },
      update: {},
    });
    await tx.entryTag.upsert({
      where: { entryId_tagId: { entryId, tagId: tag.id } },
      create: { entryId, tagId: tag.id },
      update: {},
    });
  }
}

async function attachThreads(
  tx: Prisma.TransactionClient | PrismaClient,
  userId: string,
  entryId: string,
  threadIds: string[],
): Promise<void> {
  const owned = await tx.thread.findMany({
    where: { id: { in: threadIds }, userId },
    select: { id: true },
  });
  for (const thread of owned) {
    await tx.entryThread.upsert({
      where: { entryId_threadId: { entryId, threadId: thread.id } },
      create: { entryId, threadId: thread.id },
      update: {},
    });
  }
}

export async function softDeleteEntry(userId: string, id: string): Promise<void> {
  const entry = await prisma.entry.findFirst({ where: { id, userId, deletedAt: null } });
  if (!entry) throw notFound("Entry not found");
  await prisma.entry.update({ where: { id, userId }, data: { deletedAt: new Date() } });
  await audit(userId, "entry.delete", "entry", id, { day: entry.day, words: entry.wordCount });
}

export async function restoreEntry(userId: string, id: string): Promise<void> {
  const entry = await prisma.entry.findFirst({ where: { id, userId, deletedAt: { not: null } } });
  if (!entry) throw notFound("Deleted entry not found");
  await prisma.entry.update({ where: { id, userId }, data: { deletedAt: null } });
  await audit(userId, "entry.restore", "entry", id, { day: entry.day });
}

/** Hard delete — only reachable from the trash view. */
export async function purgeEntry(userId: string, id: string): Promise<void> {
  const entry = await prisma.entry.findFirst({ where: { id, userId } });
  if (!entry) throw notFound("Entry not found");
  await prisma.entry.delete({ where: { id, userId } });
  await audit(userId, "entry.purge", "entry", id, { day: entry.day, words: entry.wordCount });
}

export async function getEntry(userId: string, id: string): Promise<EntryWithRelations> {
  const entry = await prisma.entry.findFirst({
    where: { id, userId, deletedAt: null },
    include: entryInclude,
  });
  if (!entry) throw notFound("Entry not found");
  return entry;
}

/**
 * Re-derive the stored `day` bucket for every entry after the owner's timezone
 * changes. Without this, past writing would silently belong to the wrong day in
 * the timeline, streaks and "on this day".
 */
export async function recomputeDays(userId: string, timezone: string): Promise<number> {
  const entries = await prisma.entry.findMany({
    where: { userId },
    select: { id: true, occurredAt: true, day: true },
  });

  const stale = entries.filter((e) => dayKey(e.occurredAt, timezone) !== e.day);
  if (!stale.length) return 0;

  await prisma.$transaction(
    stale.map((e) =>
      prisma.entry.update({
        where: { id: e.id, userId },
        data: { day: dayKey(e.occurredAt, timezone) },
      }),
    ),
  );
  return stale.length;
}

function buildWhere(userId: string, q: EntryQuery): Prisma.EntryWhereInput {
  const where: Prisma.EntryWhereInput = { userId, ...visibility(q.trash) };

  if (q.q) {
    // SQLite LIKE is case-insensitive for ASCII, so a plain contains works here
    // and keeps the query portable to Postgres later.
    where.OR = [{ content: { contains: q.q } }, { title: { contains: q.q } }];
  }
  if (q.from || q.to) {
    where.day = { gte: q.from ?? "0000-01-01", lte: q.to ?? "9999-12-31" };
  }
  if (q.type) where.entryType = q.type;
  if (q.mood) where.mood = q.mood;
  if (q.important) where.isImportant = true;
  if (q.tag) where.tags = { some: { tag: { userId, slug: slugifyTag(q.tag) } } };
  if (q.thread) where.threads = { some: { thread: { userId, slug: slugifyTag(q.thread) } } };
  return where;
}

export async function listEntries(
  userId: string,
  query: EntryQuery,
): Promise<{ items: EntryWithRelations[]; nextCursor: string | null; total: number }> {
  const where = buildWhere(userId, query);
  const order = query.order ?? "desc";

  const [items, total] = await Promise.all([
    prisma.entry.findMany({
      where,
      include: entryInclude,
      orderBy: [{ occurredAt: order }, { id: order }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    }),
    prisma.entry.count({ where }),
  ]);

  const hasMore = items.length > query.limit;
  const page = hasMore ? items.slice(0, query.limit) : items;
  return { items: page, nextCursor: hasMore ? page[page.length - 1].id : null, total };
}

export async function entriesForDay(
  userId: string,
  day: string,
): Promise<EntryWithRelations[]> {
  return prisma.entry.findMany({
    where: { userId, day, deletedAt: null },
    include: entryInclude,
    orderBy: { occurredAt: "asc" },
  });
}

export async function latestEntry(userId: string): Promise<EntryWithRelations | null> {
  return prisma.entry.findFirst({
    where: { userId, deletedAt: null },
    include: entryInclude,
    orderBy: { occurredAt: "desc" },
  });
}

/** Entries on the same calendar day in previous years (never fabricated). */
export async function onThisDay(
  userId: string,
  day: string,
): Promise<{ year: number; entries: EntryWithRelations[] }[]> {
  const monthDay = day.slice(5); // MM-DD
  const entries = await prisma.entry.findMany({
    where: {
      userId,
      deletedAt: null,
      day: { endsWith: `-${monthDay}` },
      NOT: { day },
    },
    include: entryInclude,
    orderBy: { day: "desc" },
  });
  const byYear = new Map<number, EntryWithRelations[]>();
  for (const entry of entries) {
    const year = Number(entry.day.slice(0, 4));
    byYear.set(year, [...(byYear.get(year) ?? []), entry]);
  }
  return [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, list]) => ({ year, entries: list }));
}

export async function daysWithEntries(userId: string, limit = 400): Promise<string[]> {
  const rows = await prisma.entry.groupBy({
    by: ["day"],
    where: { userId, deletedAt: null },
    _count: { _all: true },
    orderBy: { day: "desc" },
    take: limit,
  });
  return rows.map((r) => r.day);
}

export type HomeSummary = {
  today: string;
  todayEntries: EntryWithRelations[];
  lastEntry: EntryWithRelations | null;
  streak: number;
  unresolvedCount: number;
  weekCount: number;
  wordsThisWeek: number;
  themes: { slug: string; name: string; count: number }[];
  onThisDay: { year: number; entries: EntryWithRelations[] }[];
  prompt: string | null;
  goals: { id: string; title: string; status: string }[];
  thoughts: { id: string; question: string; updatedAt: Date; status: string }[];
};

const REFLECTION_PROMPTS = [
  "What surprised you today?",
  "What took more energy than it deserved?",
  "What would you tell yourself a year ago about today?",
  "What did you avoid, and why?",
  "What small thing went right?",
  "What are you carrying that you could put down?",
  "What did you learn about someone today?",
  "Which decision from this week still feels open?",
];

export function promptForDay(day: string): string {
  const seed = [...day].reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return REFLECTION_PROMPTS[seed % REFLECTION_PROMPTS.length];
}

/** One aggregate read for the home screen — avoids a waterfall of queries. */
export async function homeSummary(
  userId: string,
  timezone: string,
  showPrompt: boolean,
): Promise<HomeSummary> {
  const today = dayKey(new Date(), timezone);
  const weekStart = dayKey(new Date(Date.now() - 6 * 86_400_000), timezone);

  const [todayEntries, lastEntry, days, unresolvedCount, weekEntries, tagRows, goals, thoughts, memories] =
    await Promise.all([
      entriesForDay(userId, today),
      latestEntry(userId),
      daysWithEntries(userId, 400),
      prisma.unresolvedThought.count({ where: { userId, status: "open" } }),
      prisma.entry.findMany({
        where: { userId, deletedAt: null, day: { gte: weekStart, lte: today } },
        select: { wordCount: true },
      }),
      prisma.entryTag.groupBy({
        by: ["tagId"],
        where: { entry: { userId, deletedAt: null } },
        _count: { _all: true },
        orderBy: { _count: { tagId: "desc" } },
        take: 6,
      }),
      prisma.goal.findMany({
        where: { userId, status: "open" },
        orderBy: { createdAt: "desc" },
        take: 4,
        select: { id: true, title: true, status: true },
      }),
      prisma.unresolvedThought.findMany({
        where: { userId, status: "open" },
        orderBy: { updatedAt: "desc" },
        take: 4,
        select: { id: true, question: true, updatedAt: true, status: true },
      }),
      onThisDay(userId, today),
    ]);

  const tagIds = tagRows.map((row) => row.tagId);
  const tagMeta = tagIds.length
    ? await prisma.tag.findMany({ where: { id: { in: tagIds }, userId } })
    : [];
  const themes = tagRows
    .map((row) => {
      const tag = tagMeta.find((t) => t.id === row.tagId);
      return tag ? { slug: tag.slug, name: tag.name, count: row._count._all } : null;
    })
    .filter((t): t is { slug: string; name: string; count: number } => t !== null);

  return {
    today,
    todayEntries,
    lastEntry,
    streak: currentStreak(days, today),
    unresolvedCount,
    weekCount: weekEntries.length,
    wordsThisWeek: weekEntries.reduce((sum, e) => sum + e.wordCount, 0),
    themes,
    onThisDay: memories,
    prompt: showPrompt ? promptForDay(today) : null,
    goals,
    thoughts,
  };
}

/**
 * Consecutive days written, counting back from today. A missing today does not
 * break the streak until tomorrow (writing late at night should not reset it).
 */
export function currentStreak(days: string[], today: string): number {
  const set = new Set(days);
  if (set.size === 0) return 0;
  const cursor = new Date(`${today}T12:00:00Z`);
  if (!set.has(today)) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    if (!set.has(cursor.toISOString().slice(0, 10))) return 0;
  }
  let streak = 0;
  for (;;) {
    const key = cursor.toISOString().slice(0, 10);
    if (!set.has(key)) break;
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

export function entryPreview(entry: EntryWithRelations): {
  id: string;
  title: string;
  excerpt: string;
  day: string;
  entryType: string;
  mood: string | null;
  wordCount: number;
  occurredAt: string;
  isImportant: boolean;
  source: string;
  tags: string[];
  threads: string[];
} {
  return {
    id: entry.id,
    title: titleOrExcerpt(entry.title, entry.content),
    excerpt: excerpt(entry.content),
    day: entry.day,
    entryType: entry.entryType,
    mood: entry.mood,
    wordCount: entry.wordCount,
    occurredAt: entry.occurredAt.toISOString(),
    isImportant: entry.isImportant,
    source: entry.source,
    tags: entry.tags.map((t) => t.tag.slug),
    threads: entry.threads.map((t) => t.thread.name),
  };
}
