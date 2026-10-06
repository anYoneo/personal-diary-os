import { prisma } from "../db";
import { addDays, dayKey, longDate, relativeDay, shortDate } from "../day";
import { excerpt, toPlainText } from "../markdown";
import type { EntryWithRelations } from "./entries";

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "have", "from", "they", "them", "then",
  "than", "were", "was", "are", "but", "not", "you", "your", "about", "into", "just",
  "like", "really", "today", "very", "much", "some", "when", "what", "which", "been",
  "still", "because", "would", "could", "should", "there", "here", "over", "after",
  "before", "again", "only", "also", "more", "most", "does", "did", "didn", "its", "it's",
  "i'm", "im", "don't", "dont", "can't", "cant", "am", "is", "of", "to", "in", "on", "at",
  "as", "by", "be", "or", "if", "so", "we", "he", "she", "his", "her", "my", "me",
]);

export function keywords(text: string, limit = 8): string[] {
  const counts = new Map<string, number>();
  for (const raw of toPlainText(text).toLowerCase().split(/[^\p{L}\p{N}']+/u)) {
    const word = raw.replace(/^'+|'+$/g, "");
    if (word.length < 4 || STOPWORDS.has(word) || /^\d+$/.test(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word]) => word);
}

/** Overlap coefficient over keyword sets — cheap, explainable, no model needed. */
export function similarity(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  const shared = a.filter((w) => setB.has(w)).length;
  return shared / Math.min(a.length, b.length);
}

/**
 * "Memory echo": older entries that talk about what this entry talks about.
 * This is deliberately local similarity (keyword overlap + shared tags/threads),
 * not an AI claim — the UI labels it as related writing, never as an insight.
 */
export async function relatedMemories(
  userId: string,
  entry: { id: string; content: string; day: string; tags?: { tag: { slug: string } }[]; threads?: { threadId: string }[] },
  limit = 3,
): Promise<{ entry: EntryWithRelations; reason: string; score: number }[]> {
  const words = keywords(entry.content, 12);
  const tagSlugs = entry.tags?.map((t) => t.tag.slug) ?? [];
  const threadIds = entry.threads?.map((t) => t.threadId) ?? [];

  const candidates = await prisma.entry.findMany({
    where: {
      userId,
      deletedAt: null,
      id: { not: entry.id },
      occurredAt: { lt: new Date() },
      OR: [
        words.length ? { OR: words.map((w) => ({ content: { contains: w } })) } : { id: "__none__" },
        tagSlugs.length ? { tags: { some: { tag: { slug: { in: tagSlugs } } } } } : { id: "__none__" },
        threadIds.length ? { threads: { some: { threadId: { in: threadIds } } } } : { id: "__none__" },
      ],
    },
    include: { tags: { include: { tag: true } }, threads: { include: { thread: true } } },
    orderBy: { occurredAt: "desc" },
    take: 60,
  });

  return candidates
    .map((candidate) => {
      const textScore = similarity(words, keywords(candidate.content, 12));
      const sharedTags = candidate.tags.filter((t) => tagSlugs.includes(t.tag.slug)).length;
      const sharedThreads = candidate.threads.filter((t) => threadIds.includes(t.threadId)).length;
      const score = textScore + sharedTags * 0.12 + sharedThreads * 0.15;
      const reasons: string[] = [];
      if (sharedThreads) reasons.push("same thread");
      if (sharedTags) reasons.push("shared tags");
      if (textScore > 0.28) reasons.push("similar words");
      return {
        entry: candidate,
        reason: reasons[0] ?? "related writing",
        score: Math.round(score * 100) / 100,
      };
    })
    .filter((candidate) => candidate.score >= 0.24)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export type ResurfacedMemory = {
  mode: string;
  label: string;
  day: string;
  yearsAgo: number | null;
  entry: {
    id: string;
    title: string;
    excerpt: string;
    mood: string | null;
    entryType: string;
    wordCount: number;
  };
  note: string;
};

function toMemory(entry: EntryWithRelations, mode: string, label: string, note: string, today?: string): ResurfacedMemory {
  const yearsAgo = today
    ? Math.max(0, Math.floor((Date.parse(today) - Date.parse(entry.day)) / 31_557_600_000))
    : null;
  return {
    mode,
    label,
    day: entry.day,
    yearsAgo,
    entry: {
      id: entry.id,
      title: entry.title?.trim() || excerpt(entry.content, 60),
      excerpt: excerpt(entry.content, 420),
      mood: entry.mood,
      entryType: entry.entryType,
      wordCount: entry.wordCount,
    },
    note,
  };
}

export async function randomMemory(
  userId: string,
  opts: { minAgeDays?: number } = {},
): Promise<ResurfacedMemory | null> {
  const minAgeDays = opts.minAgeDays ?? 30;
  const cutoff = new Date(Date.now() - minAgeDays * 86_400_000);
  const count = await prisma.entry.count({ where: { userId, deletedAt: null, occurredAt: { lt: cutoff } } });
  if (count === 0) return null;
  const skip = Math.floor(Math.random() * count);
  const entry = await prisma.entry.findFirst({
    where: { userId, deletedAt: null, occurredAt: { lt: cutoff } },
    include: { tags: { include: { tag: true } }, threads: { include: { thread: true } } },
    orderBy: { occurredAt: "desc" },
    skip,
  });
  if (!entry) return null;
  return toMemory(entry, "random", shortDate(entry.day), "Pulled at random from your archive.");
}

export async function forwardMemory(
  userId: string,
  today: string,
): Promise<ResurfacedMemory | null> {
  const rows = await prisma.entry.findMany({
    where: { userId, deletedAt: null, day: { endsWith: `-${today.slice(5)}` }, NOT: { day: today } },
    include: { tags: { include: { tag: true } }, threads: { include: { thread: true } } },
    orderBy: { day: "desc" },
  });
  const pick = rows[Math.floor(Math.random() * rows.length)];
  if (!pick) return null;
  const relative = relativeDay(pick.day, today);
  return toMemory(pick, "on-this-day", shortDate(pick.day), `You wrote this ${relative}.`, today);
}

/**
 * Topics that used to appear and then stopped. Requires a real gap (>= 90 days)
 * and at least 3 mentions before, so a one-off note never gets called a "thread".
 */
export async function ghostThreads(userId: string, today: string, limit = 6) {
  const threads = await prisma.thread.findMany({
    where: { userId, status: { not: "archived" } },
    include: { entries: { include: { entry: { select: { day: true, deletedAt: true } } } } },
  });

  const quietDays = 90;
  const cutoff = addDays(today, -quietDays);

  return threads
    .map((thread) => {
      const days = thread.entries
        .filter((e) => !e.entry.deletedAt)
        .map((e) => e.entry.day)
        .sort();
      if (days.length < 3) return null;
      const last = days[days.length - 1];
      if (last >= cutoff) return null; // still active — not a ghost
      const gapDays = Math.round((Date.parse(today) - Date.parse(last)) / 86_400_000);
      return {
        id: thread.id,
        name: thread.name,
        slug: thread.slug,
        kind: thread.kind,
        mentions: days.length,
        first: days[0],
        last,
        gapDays,
      };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null)
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, limit);
}

/**
 * Perspective change: two entries that talk about the same thread (or the same
 * subject word) and use opposite sentiment words. The app reports the pair and
 * never decides which is "correct".
 */
const POSITIVE = ["enjoy", "love", "great", "good", "happy", "excited", "proud", "grateful", "better", "worth", "fun"];
const NEGATIVE = ["hate", "tired", "stuck", "awful", "terrible", "sad", "angry", "anxious", "burnout", "hard", "afraid"];

function polarity(text: string): number {
  const t = toPlainText(text).toLowerCase();
  let score = 0;
  for (const word of POSITIVE) score += (t.match(new RegExp(`\\b${word}\\b`, "g")) ?? []).length;
  for (const word of NEGATIVE) score -= (t.match(new RegExp(`\\b${word}\\b`, "g")) ?? []).length;
  return score;
}

export async function perspectiveShifts(userId: string, limit = 4) {
  const threads = await prisma.thread.findMany({
    where: { userId },
    include: {
      entries: {
        include: {
          entry: { select: { id: true, content: true, day: true, deletedAt: true, title: true } },
        },
      },
    },
  });

  const findings: {
    thread: string;
    slug: string;
    before: { id: string; day: string; snippet: string };
    after: { id: string; day: string; snippet: string };
    gapDays: number;
  }[] = [];

  for (const thread of threads) {
    const entries = thread.entries
      .filter((e) => !e.entry.deletedAt)
      .map((e) => ({ ...e.entry, polarity: polarity(e.entry.content) }))
      .sort((a, b) => (a.day < b.day ? -1 : 1));
    if (entries.length < 2) continue;

    const negative = entries.filter((e) => e.polarity <= -1);
    const positive = entries.filter((e) => e.polarity >= 1);
    if (!negative.length || !positive.length) continue;

    const before = negative[0];
    const after = positive.find((e) => e.day > before.day);
    if (!after) continue;

    const gapDays = Math.round((Date.parse(after.day) - Date.parse(before.day)) / 86_400_000);
    if (gapDays < 30) continue; // needs real distance to be meaningful

    findings.push({
      thread: thread.name,
      slug: thread.slug,
      before: { id: before.id, day: before.day, snippet: excerpt(before.content, 200) },
      after: { id: after.id, day: after.day, snippet: excerpt(after.content, 200) },
      gapDays,
    });
  }

  return findings.sort((a, b) => b.gapDays - a.gapDays).slice(0, limit);
}

/**
 * Long-term threads: every subject with its first/last mention and cadence.
 * Built from real entries only.
 */
export async function lifeThreads(userId: string) {
  const threads = await prisma.thread.findMany({
    where: { userId },
    include: {
      entries: { include: { entry: { select: { day: true, deletedAt: true } } } },
      goals: { select: { id: true, title: true, status: true } },
    },
    orderBy: { name: "asc" },
  });

  return threads
    .map((thread) => {
      const days = thread.entries
        .filter((e) => !e.entry.deletedAt)
        .map((e) => e.entry.day)
        .sort();
      const byMonth = new Map<string, number>();
      for (const day of days) {
        const month = day.slice(0, 7);
        byMonth.set(month, (byMonth.get(month) ?? 0) + 1);
      }
      return {
        id: thread.id,
        name: thread.name,
        slug: thread.slug,
        kind: thread.kind,
        description: thread.description,
        status: thread.status,
        mentions: days.length,
        first: days[0] ?? null,
        last: days[days.length - 1] ?? null,
        byMonth: [...byMonth.entries()]
          .sort((a, b) => (a[0] < b[0] ? -1 : 1))
          .map(([month, count]) => ({ month, count })),
        goals: thread.goals,
      };
    })
    .sort((a, b) => b.mentions - a.mentions);
}

export async function memoryDigest(userId: string, today: string) {
  const [random, onThisDay, ghosts, shifts, threads, todayEntries] = await Promise.all([
    randomMemory(userId),
    forwardMemory(userId, today),
    ghostThreads(userId, today),
    perspectiveShifts(userId),
    lifeThreads(userId),
    prisma.entry.findMany({
      where: { userId, deletedAt: null },
      orderBy: { occurredAt: "desc" },
      take: 1,
      select: { day: true, id: true },
    }),
  ]);

  return {
    today,
    todayLong: longDate(today),
    random,
    onThisDay,
    ghosts,
    shifts,
    threads: threads.slice(0, 12),
    lastWrittenDay: todayEntries[0]?.day ?? null,
  };
}

export { dayKey };
