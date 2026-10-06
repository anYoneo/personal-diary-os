import { prisma } from "../db";
import { addDays, dayKey, monthLabel, parseDayKey } from "../day";

export type TimelineMonth = {
  month: string; // YYYY-MM
  label: string; // September 2026
  count: number;
  words: number;
  entries: {
    id: string;
    day: string;
    title: string;
    entryType: string;
    mood: string | null;
    wordCount: number;
    source: string;
    isImportant: boolean;
  }[];
};

export type Timeline = {
  year: number;
  months: TimelineMonth[];
  total: number;
  availableYears: number[];
};

/**
 * Timeline for one month (or a whole year when `month` is omitted). Grouped by
 * the entry's local day, newest first — the shape the rail renders directly.
 */
export async function timeline(
  userId: string,
  opts: { year: number; month?: number | null },
): Promise<Timeline> {
  const from = `${opts.year}-01-01`;
  const to = `${opts.year}-12-31`;

  const rows = await prisma.entry.findMany({
    where: {
      userId,
      deletedAt: null,
      day: { gte: opts.month ? `${opts.year}-${String(opts.month).padStart(2, "0")}-01` : from,
             lte: opts.month ? `${opts.year}-${String(opts.month).padStart(2, "0")}-31` : to },
    },
    orderBy: { occurredAt: "desc" },
    select: {
      id: true,
      day: true,
      title: true,
      content: true,
      entryType: true,
      mood: true,
      wordCount: true,
      source: true,
      isImportant: true,
    },
  });

  const byMonth = new Map<string, TimelineMonth>();
  for (const row of rows) {
    const month = row.day.slice(0, 7);
    const bucket = byMonth.get(month) ?? {
      month,
      label: monthLabel(month),
      count: 0,
      words: 0,
      entries: [],
    };
    bucket.count += 1;
    bucket.words += row.wordCount;
    bucket.entries.push({
      id: row.id,
      day: row.day,
      title: row.title?.trim() || firstLine(row.content),
      entryType: row.entryType,
      mood: row.mood,
      wordCount: row.wordCount,
      source: row.source,
      isImportant: row.isImportant,
    });
    byMonth.set(month, bucket);
  }

  const years = await prisma.entry.findMany({
    where: { userId, deletedAt: null },
    select: { day: true },
    distinct: ["day"],
    orderBy: { day: "desc" },
  });
  const availableYears = [...new Set(years.map((y) => Number(y.day.slice(0, 4))))].sort(
    (a, b) => b - a,
  );

  return {
    year: opts.year,
    months: [...byMonth.values()].sort((a, b) => (a.month < b.month ? 1 : -1)),
    total: rows.length,
    availableYears: availableYears.length ? availableYears : [opts.year],
  };
}

function firstLine(content: string): string {
  const line = content
    .split("\n")
    .map((l) => l.replace(/^[#>*\-\s]+/, "").trim())
    .find((l) => l.length > 0);
  return line?.slice(0, 90) || "Untitled entry";
}

/** Writing activity per day for the last N days — feeds the heatmap. */
export async function activityHeatmap(userId: string, today: string, days = 182) {
  const from = addDays(today, -(days - 1));
  const rows = await prisma.entry.groupBy({
    by: ["day"],
    where: { userId, deletedAt: null, day: { gte: from, lte: today } },
    _count: { _all: true },
    _sum: { wordCount: true },
  });

  const map = new Map(rows.map((r) => [r.day, { count: r._count._all, words: r._sum.wordCount ?? 0 }]));
  const cells: { day: string; count: number; words: number; level: number }[] = [];

  for (let i = 0; i < days; i += 1) {
    const day = addDays(from, i);
    const stats = map.get(day) ?? { count: 0, words: 0 };
    cells.push({
      day,
      count: stats.count,
      words: stats.words,
      level: stats.count === 0 ? 0 : stats.count === 1 ? 1 : stats.count === 2 ? 2 : stats.count >= 4 ? 4 : 3,
    });
  }

  return cells;
}

export type InsightReport = {
  totals: {
    entries: number;
    words: number;
    days: number;
    avgWords: number;
    longestEntry: { id: string; day: string; words: number } | null;
  };
  cadence: {
    thisWeek: number;
    lastWeek: number;
    thisMonth: number;
    lastMonth: number;
    activeDays30: number;
    silenceDays: { since: string; days: number } | null;
  };
  topTags: { slug: string; name: string; count: number }[];
  moodCounts: { mood: string; count: number }[];
  types: { entryType: string; count: number }[];
  byHour: { hour: number; count: number }[];
  streaks: { current: number; longest: number; longestRange: { from: string; to: string } | null };
  monthly: { month: string; count: number; words: number }[];
  sources: { source: string; count: number }[];
};

/**
 * Analytics built from stored rows. Every number here is a count of something
 * that exists — no estimated or modelled metrics.
 */
export async function insights(userId: string, today: string): Promise<InsightReport> {
  const entries = await prisma.entry.findMany({
    where: { userId, deletedAt: null },
    select: {
      id: true,
      day: true,
      occurredAt: true,
      wordCount: true,
      mood: true,
      entryType: true,
      source: true,
      tags: { include: { tag: true } },
    },
    orderBy: { day: "asc" },
  });

  const days = [...new Set(entries.map((e) => e.day))].sort();
  const words = entries.reduce((sum, e) => sum + e.wordCount, 0);
  const longestEntry = entries.reduce<(typeof entries)[number] | null>(
    (best, e) => (!best || e.wordCount > best.wordCount ? e : best),
    null,
  );

  const weekStart = addDays(today, -6);
  const lastWeekStart = addDays(today, -13);
  const monthStart = `${today.slice(0, 7)}-01`;
  const prevMonthKey = addDays(monthStart, -1).slice(0, 7);

  const tagCounts = new Map<string, { slug: string; name: string; count: number }>();
  for (const entry of entries) {
    for (const { tag } of entry.tags) {
      const current = tagCounts.get(tag.slug) ?? { slug: tag.slug, name: tag.name, count: 0 };
      current.count += 1;
      tagCounts.set(tag.slug, current);
    }
  }

  const moodCounts = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.mood) continue;
    moodCounts.set(entry.mood, (moodCounts.get(entry.mood) ?? 0) + 1);
  }

  const typeCounts = new Map<string, number>();
  const hourCounts = new Map<number, number>();
  const sourceCounts = new Map<string, number>();
  const monthly = new Map<string, { count: number; words: number }>();

  for (const entry of entries) {
    typeCounts.set(entry.entryType, (typeCounts.get(entry.entryType) ?? 0) + 1);
    sourceCounts.set(entry.source, (sourceCounts.get(entry.source) ?? 0) + 1);
    const hour = entry.occurredAt.getHours();
    hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
    const month = entry.day.slice(0, 7);
    const bucket = monthly.get(month) ?? { count: 0, words: 0 };
    bucket.count += 1;
    bucket.words += entry.wordCount;
    monthly.set(month, bucket);
  }

  // Longest streak of consecutive written days.
  let longestStreak = 0;
  let currentRun = 0;
  let previous: string | null = null;
  let runStart: string | null = null;
  let bestRange: { from: string; to: string } | null = null;
  for (const day of days) {
    if (previous && addDays(previous, 1) === day) {
      currentRun += 1;
    } else {
      currentRun = 1;
      runStart = day;
    }
    if (currentRun > longestStreak && runStart) {
      longestStreak = currentRun;
      bestRange = { from: runStart, to: day };
    }
    previous = day;
  }

  /**
   * Silent period: consecutive days with no writing, counting back from today.
   * Expressed as "nothing since <date>" — the honest framing of a gap.
   */
  let silence: { since: string; days: number } | null = null;
  const lastWritten = [...days].reverse().find((day) => day <= today);
  if (lastWritten && lastWritten < today) {
    const since = addDays(lastWritten, 1);
    const gaps = Math.round((Date.parse(today) - Date.parse(lastWritten)) / 86_400_000);
    if (gaps >= 2) silence = { since, days: gaps };
  }

  return {
    totals: {
      entries: entries.length,
      words,
      days: days.length,
      avgWords: entries.length ? Math.round(words / entries.length) : 0,
      longestEntry: longestEntry
        ? { id: longestEntry.id, day: longestEntry.day, words: longestEntry.wordCount }
        : null,
    },
    cadence: {
      thisWeek: entries.filter((e) => e.day >= weekStart && e.day <= today).length,
      lastWeek: entries.filter((e) => e.day >= lastWeekStart && e.day < weekStart).length,
      thisMonth: entries.filter((e) => e.day >= monthStart).length,
      lastMonth: entries.filter((e) => e.day.startsWith(prevMonthKey)).length,
      activeDays30: days.filter((d) => d >= addDays(today, -29)).length,
      silenceDays: silence,
    },
    topTags: [...tagCounts.values()].sort((a, b) => b.count - a.count).slice(0, 12),
    moodCounts: [...moodCounts.entries()]
      .map(([mood, count]) => ({ mood, count }))
      .sort((a, b) => b.count - a.count),
    types: [...typeCounts.entries()]
      .map(([entryType, count]) => ({ entryType, count }))
      .sort((a, b) => b.count - a.count),
    byHour: Array.from({ length: 24 }, (_, hour) => ({ hour, count: hourCounts.get(hour) ?? 0 })),
    streaks: { current: 0, longest: longestStreak, longestRange: bestRange },
    monthly: [...monthly.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([month, stats]) => ({ month, ...stats })),
    sources: [...sourceCounts.entries()].map(([source, count]) => ({ source, count })),
  };
}

/** Weekly/monthly reflection payload: facts only, clearly separable from AI text. */
export async function reflectionFacts(userId: string, today: string, period: "week" | "month") {
  const from = period === "week" ? addDays(today, -6) : `${today.slice(0, 7)}-01`;
  const rows = await prisma.entry.findMany({
    where: { userId, deletedAt: null, day: { gte: from, lte: today } },
    include: { tags: { include: { tag: true } }, threads: { include: { thread: true } } },
    orderBy: { day: "asc" },
  });

  const tagCounts = new Map<string, number>();
  const threadCounts = new Map<string, number>();
  for (const row of rows) {
    for (const { tag } of row.tags) tagCounts.set(tag.slug, (tagCounts.get(tag.slug) ?? 0) + 1);
    for (const { thread } of row.threads) {
      threadCounts.set(thread.name, (threadCounts.get(thread.name) ?? 0) + 1);
    }
  }

  const openThoughts = await prisma.unresolvedThought.findMany({
    where: { userId, status: "open" },
    select: { id: true, question: true, createdAt: true },
  });

  return {
    period,
    from,
    to: today,
    entryCount: rows.length,
    words: rows.reduce((sum, r) => sum + r.wordCount, 0),
    days: [...new Set(rows.map((r) => r.day))].sort(),
    tags: [...tagCounts.entries()].map(([slug, count]) => ({ slug, count })).sort((a, b) => b.count - a.count),
    threads: [...threadCounts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    openThoughts,
    moods: rows.reduce<Record<string, number>>((acc, row) => {
      if (row.mood) acc[row.mood] = (acc[row.mood] ?? 0) + 1;
      return acc;
    }, {}),
    /** Facts the reflection text is allowed to cite. */
    citedEntries: rows.map((r) => ({ id: r.id, day: r.day, title: r.title })),
  };
}

export { dayKey, parseDayKey };
