import { prisma } from "../db";
import { slugifyTag, type EntryWithRelations } from "./entries";
import { toPlainText } from "../markdown";

export type SearchHit = {
  id: string;
  title: string;
  excerpt: string;
  day: string;
  entryType: string;
  mood: string | null;
  score: number;
  matchedIn: "title" | "content" | "tag" | "thread";
  tags: string[];
  threads: string[];
};

export type SearchResult = {
  query: string;
  hits: SearchHit[];
  total: number;
  tookMs: number;
  /** Optional AI layer: null when not configured, so the UI can say so honestly. */
  semantic: null | { answer: string; sources: string[] };
  filters: {
    from?: string;
    to?: string;
    type?: string;
    mood?: string;
    tag?: string;
    thread?: string;
  };
};

type SearchInput = {
  q: string;
  from?: string;
  to?: string;
  type?: string;
  mood?: string;
  tag?: string;
  thread?: string;
  limit?: number;
};

/**
 * Keyword search over entries. Ranking is intentionally simple and explainable:
 * title hits beat body hits, and recency breaks ties. The `entry_embeddings`
 * table + AI layer can be added later without changing this contract.
 */
export async function searchEntries(userId: string, input: SearchInput): Promise<SearchResult> {
  const started = Date.now();
  const limit = Math.min(input.limit ?? 40, 100);
  const q = input.q.trim();

  const where = {
    userId,
    deletedAt: null,
    ...(input.from || input.to
      ? { day: { gte: input.from ?? "0000-01-01", lte: input.to ?? "9999-12-31" } }
      : {}),
    ...(input.type ? { entryType: input.type } : {}),
    ...(input.mood ? { mood: input.mood } : {}),
    ...(input.tag ? { tags: { some: { tag: { userId, slug: slugifyTag(input.tag) } } } } : {}),
    ...(input.thread
      ? { threads: { some: { thread: { userId, slug: slugifyTag(input.thread) } } } }
      : {}),
    ...(q
      ? { OR: [{ content: { contains: q } }, { title: { contains: q } }] }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.entry.findMany({
      where,
      include: { tags: { include: { tag: true } }, threads: { include: { thread: true } } },
      orderBy: { occurredAt: "desc" },
      take: limit,
    }),
    prisma.entry.count({ where }),
  ]);

  const hits = rows.map((row) => score(row, q)).sort((a, b) => b.score - a.score || (a.day < b.day ? 1 : -1));

  return {
    query: q,
    hits,
    total,
    tookMs: Date.now() - started,
    semantic: null,
    filters: {
      from: input.from,
      to: input.to,
      type: input.type,
      mood: input.mood,
      tag: input.tag,
      thread: input.thread,
    },
  };
}

function score(entry: EntryWithRelations, query: string): SearchHit {
  const title = entry.title ?? "";
  const plain = toPlainText(entry.content);
  const q = query.toLowerCase();

  let matchedIn: SearchHit["matchedIn"] = "content";
  let base = 1;

  if (q) {
    if (title.toLowerCase().includes(q)) {
      matchedIn = "title";
      base = 6;
    } else if (entry.tags.some((t) => t.tag.name.includes(q) || t.tag.slug.includes(q))) {
      matchedIn = "tag";
      base = 4;
    } else if (entry.threads.some((t) => t.thread.name.toLowerCase().includes(q))) {
      matchedIn = "thread";
      base = 3;
    }
    // Density of the term nudges ranking, capped so long entries don't dominate.
    const occurrences = q ? plain.toLowerCase().split(q).length - 1 : 0;
    base += Math.min(occurrences, 5) * 0.4;
  }

  // Exact phrase in the plain text is worth a little more than scattered words.
  if (q && plain.toLowerCase().includes(q)) base += 0.8;

  return {
    id: entry.id,
    title: entry.title?.trim() || plain.slice(0, 70),
    excerpt: highlight(plain, query),
    day: entry.day,
    entryType: entry.entryType,
    mood: entry.mood,
    score: Math.round(base * 100) / 100,
    matchedIn,
    tags: entry.tags.map((t) => t.tag.slug),
    threads: entry.threads.map((t) => t.thread.name),
  };
}

/** Excerpt centred on the match, so the hit is visible without opening the entry. */
function highlight(plain: string, query: string, radius = 120): string {
  if (!query) return plain.slice(0, radius * 2);
  const idx = plain.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return plain.slice(0, radius * 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(plain.length, idx + query.length + radius);
  return `${start > 0 ? "…" : ""}${plain.slice(start, end)}${end < plain.length ? "…" : ""}`;
}

/**
 * Entity buckets: first/last mention and the raw mention count for anything the
 * user writes about. Computed from stored data — nothing is inferred or invented.
 */
export async function mentionStats(userId: string, keyword: string) {
  const q = keyword.trim();
  if (!q) return null;

  const rows = await prisma.entry.findMany({
    where: {
      userId,
      deletedAt: null,
      OR: [{ content: { contains: q } }, { title: { contains: q } }],
    },
    orderBy: { occurredAt: "asc" },
    select: { id: true, day: true, title: true, occurredAt: true },
  });

  if (rows.length === 0) {
    return { keyword: q, mentions: 0, firstMention: null, lastMention: null, byMonth: [] as { month: string; count: number }[] };
  }

  const first = rows[0];
  const last = rows[rows.length - 1];
  const byMonth = new Map<string, number>();
  for (const row of rows) {
    const month = row.day.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + 1);
  }

  return {
    keyword: q,
    mentions: rows.length,
    firstMention: { id: first.id, day: first.day, title: first.title },
    lastMention: { id: last.id, day: last.day, title: last.title },
    byMonth: [...byMonth.entries()].map(([month, count]) => ({ month, count })),
  };
}
