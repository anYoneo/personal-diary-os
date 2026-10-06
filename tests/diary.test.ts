import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createEntry,
  updateEntry,
  softDeleteEntry,
  restoreEntry,
  purgeEntry,
  listEntries,
  onThisDay,
  currentStreak,
  entriesForDay,
} from "@/lib/services/entries";
import { searchEntries, mentionStats } from "@/lib/services/memory";
import { randomMemory, ghostThreads, lifeThreads, perspectiveShifts, relatedMemories } from "@/lib/services/memory-graph";
import { insights, reflectionFacts, activityHeatmap } from "@/lib/services/insights";
import { prisma } from "@/lib/db";
import { config } from "@/lib/config";

const TZ = "Asia/Jakarta";
let userId = "";

async function wipe() {
  const order = [
    "entryTag", "entryThread", "attachment", "aiInsight", "notificationOutbox",
    "auditLog", "unresolvedThought", "goal", "entry", "tag", "thread",
    "reminder", "linkCode", "discordLink", "userSettings", "session", "user",
  ] as const;
  for (const model of order) {
    // @ts-expect-error dynamic delegate access in tests
    await prisma[model].deleteMany();
  }
}

beforeAll(async () => {
  // Schema is pushed once by tests/global-setup.ts.
});

beforeEach(async () => {
  await wipe();
  const user = await prisma.user.create({
    data: {
      email: "diary@test.local",
      passwordHash: "scrypt$00$00",
      timezone: TZ,
      settings: { create: { timezone: TZ } },
    },
  });
  userId = user.id;
  // Discord delivery is operator-only (lib/notify.ts), so the outbox tests below
  // need this account to be the operator. What they assert is the payload shape,
  // not the gate — tests/notify-gate.test.ts covers who is allowed to receive.
  (config as { betaAdminEmail: string }).betaAdminEmail = "diary@test.local";
});

afterAll(async () => {
  await prisma.$disconnect();
});

const at = (iso: string) => new Date(iso);

describe("entry lifecycle", () => {
  it("stores an entry with a timezone-correct day and word count", async () => {
    const entry = await createEntry(userId, TZ, {
      content: "Today I finally shipped the credit limit table.",
      entryType: "work",
      mood: "motivated",
      occurredAt: at("2026-09-28T16:30:00Z"), // 23:30 in Jakarta → still the 28th
    });

    expect(entry.day).toBe("2026-09-28");
    expect(entry.wordCount).toBe(8);
    expect(entry.source).toBe("web");
  });

  it("buckets late-night writing into the next local day", async () => {
    const entry = await createEntry(userId, TZ, {
      content: "Still awake, thinking about the migration.",
      occurredAt: at("2026-09-28T18:00:00Z"), // 01:00 on the 29th in Jakarta
    });
    expect(entry.day).toBe("2026-09-29");
  });

  it("attaches tags and threads, creating tags on demand", async () => {
    const thread = await prisma.thread.create({
      data: { userId, name: "Career", slug: "career", kind: "life" },
    });

    const entry = await createEntry(userId, TZ, {
      content: "Thinking about the next role.",
      tags: ["Work", "  career ", "work"],
      threadIds: [thread.id],
    });

    const slugs = entry.tags.map((t) => t.tag.slug).sort();
    expect(slugs).toEqual(["career", "work"]);
    expect(entry.threads).toHaveLength(1);

    // A second entry reuses the same tag row rather than duplicating it.
    await createEntry(userId, TZ, { content: "More career notes", tags: ["career"] });
    expect(await prisma.tag.count({ where: { userId } })).toBe(2);
  });

  it("ignores threads that belong to someone else", async () => {
    const other = await prisma.user.create({
      data: { email: "other@test.local", passwordHash: "x", timezone: TZ },
    });
    const foreign = await prisma.thread.create({
      data: { userId: other.id, name: "Private", slug: "private" },
    });

    const entry = await createEntry(userId, TZ, {
      content: "Should not link.",
      threadIds: [foreign.id],
    });
    expect(entry.threads).toHaveLength(0);
  });

  it("deduplicates by sourceRef so Discord retries cannot double-write", async () => {
    const first = await createEntry(userId, TZ, {
      content: "from discord",
      source: "discord",
      sourceRef: "discord:123:abc",
      dedupeBySourceRef: true,
    });
    const second = await createEntry(userId, TZ, {
      content: "from discord",
      source: "discord",
      sourceRef: "discord:123:abc",
      dedupeBySourceRef: true,
    });
    expect(second.id).toBe(first.id);
    expect(await prisma.entry.count()).toBe(1);
  });

  it("bumps the version on update and rejects a stale edit", async () => {
    const entry = await createEntry(userId, TZ, { content: "first draft" });
    expect(entry.version).toBe(1);

    const updated = await updateEntry(userId, entry.id, {
      content: "second draft",
      expectedVersion: 1,
    });
    expect(updated.version).toBe(2);
    expect(updated.wordCount).toBe(2);

    await expect(
      updateEntry(userId, entry.id, { content: "stale tab", expectedVersion: 1 }),
    ).rejects.toThrow(/changed since you opened/i);
  });

  it("refuses the second of two simultaneous saves instead of applying both", async () => {
    // The reported failure, pinned. Two overlapping saves carrying the same
    // expectedVersion used to be applied one after the other (measured: 200+200,
    // the row landing at version 3) because the version check and the UPDATE did
    // not see each other. Exactly one must now win; the loser must be told.
    const entry = await createEntry(userId, TZ, { content: "before the race" });

    const outcomes = await Promise.allSettled([
      updateEntry(userId, entry.id, { content: "save A", expectedVersion: entry.version }),
      updateEntry(userId, entry.id, { content: "save B", expectedVersion: entry.version }),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String((rejected[0] as PromiseRejectedResult).reason)).toMatch(/changed since you opened/i);

    const winner = (fulfilled[0] as PromiseFulfilledResult<{ content: string; version: number }>).value;
    // The surviving content is one of the two writes, at version 2 — never a
    // blend, and never a silently-dropped third version.
    expect(["save A", "save B"]).toContain(winner.content);
    expect(winner.version).toBe(2);
  });

  it("recomputes the day when the occurred date changes", async () => {
    const entry = await createEntry(userId, TZ, { content: "wrong day" });
    const moved = await updateEntry(userId, entry.id, {
      occurredAt: at("2026-01-05T03:00:00Z"),
    });
    expect(moved.day).toBe("2026-01-05");
  });

  it("replaces tags on update rather than appending", async () => {
    const entry = await createEntry(userId, TZ, { content: "tagged", tags: ["alpha", "beta"] });
    const updated = await updateEntry(userId, entry.id, { tags: ["gamma"] });
    expect(updated.tags.map((t) => t.tag.slug)).toEqual(["gamma"]);
  });

  it("soft deletes, hides from lists, then restores", async () => {
    const entry = await createEntry(userId, TZ, { content: "delete me" });
    await softDeleteEntry(userId, entry.id);

    const visible = await listEntries(userId, { limit: 30, order: "desc" } as never);
    expect(visible.items).toHaveLength(0);

    const trash = await listEntries(userId, { limit: 30, order: "desc", trash: true } as never);
    expect(trash.items).toHaveLength(1);

    await restoreEntry(userId, entry.id);
    const restored = await listEntries(userId, { limit: 30, order: "desc" } as never);
    expect(restored.items).toHaveLength(1);

    // Destructive operations leave an audit trail without diary content.
    const logs = await prisma.auditLog.findMany({ where: { userId } });
    expect(logs.map((l) => l.action).sort()).toEqual(["entry.delete", "entry.restore"]);
    expect(JSON.stringify(logs)).not.toContain("delete me");
  });

  it("hard deletes only when asked", async () => {
    const entry = await createEntry(userId, TZ, { content: "purge me" });
    await purgeEntry(userId, entry.id);
    expect(await prisma.entry.count()).toBe(0);
  });

  it("refuses to touch another user's entry", async () => {
    const entry = await createEntry(userId, TZ, { content: "mine" });
    const other = await prisma.user.create({
      data: { email: "intruder@test.local", passwordHash: "x", timezone: TZ },
    });
    await expect(updateEntry(other.id, entry.id, { content: "hijacked" })).rejects.toThrow(
      /not found/i,
    );
    await expect(softDeleteEntry(other.id, entry.id)).rejects.toThrow(/not found/i);
  });
});

describe("timeline windows", () => {
  it("returns only entries on the requested local day", async () => {
    await createEntry(userId, TZ, { content: "on the day", occurredAt: at("2026-09-28T03:00:00Z") });
    await createEntry(userId, TZ, { content: "next day", occurredAt: at("2026-09-29T03:00:00Z") });

    const today = await entriesForDay(userId, "2026-09-28");
    expect(today).toHaveLength(1);
    expect(today[0].content).toBe("on the day");
  });

  it("finds the same calendar day in earlier years", async () => {
    await createEntry(userId, TZ, { content: "one year ago", occurredAt: at("2025-09-28T04:00:00Z") });
    await createEntry(userId, TZ, { content: "two years ago", occurredAt: at("2024-09-28T04:00:00Z") });
    await createEntry(userId, TZ, { content: "unrelated", occurredAt: at("2024-09-27T04:00:00Z") });

    const memories = await onThisDay(userId, "2026-09-28");
    expect(memories.map((m) => m.year)).toEqual([2025, 2024]);
    expect(memories[0].entries[0].content).toBe("one year ago");
  });

  it("never invents a memory when nothing matches", async () => {
    await createEntry(userId, TZ, { content: "only today", occurredAt: at("2026-09-28T04:00:00Z") });
    expect(await onThisDay(userId, "2026-09-28")).toHaveLength(0);
  });

  it("computes streaks from stored days", async () => {
    for (const day of ["2026-09-26", "2026-09-27", "2026-09-28"]) {
      await createEntry(userId, TZ, { content: `entry ${day}`, occurredAt: at(`${day}T04:00:00Z`) });
    }
    const days = await prisma.entry.findMany({ select: { day: true } });
    expect(currentStreak(days.map((d) => d.day), "2026-09-28")).toBe(3);
  });
});

describe("search", () => {
  beforeEach(async () => {
    await createEntry(userId, TZ, {
      content: "The Oracle migration is stuck on credit limits.",
      title: "Oracle migration",
      tags: ["work", "erp"],
      occurredAt: at("2026-03-04T04:00:00Z"),
      entryType: "work",
      mood: "anxious",
    });
    await createEntry(userId, TZ, {
      content: "Ran 8km before work, felt great.",
      occurredAt: at("2026-03-05T04:00:00Z"),
      entryType: "personal",
      mood: "good",
    });
  });

  it("matches on content and reports where it matched", async () => {
    const result = await searchEntries(userId, { q: "Oracle" });
    expect(result.total).toBe(1);
    expect(result.hits[0].matchedIn).toBe("title"); // title hit outranks body
    expect(result.hits[0].excerpt).toContain("Oracle");
  });

  it("applies tag, mood, type and date filters together", async () => {
    const byTag = await searchEntries(userId, { q: "", tag: "work" });
    expect(byTag.total).toBe(1);

    const byMood = await searchEntries(userId, { q: "", mood: "good" });
    expect(byMood.hits[0].excerpt).toContain("Ran 8km");

    const byRange = await searchEntries(userId, { q: "", from: "2026-03-05", to: "2026-03-31" });
    expect(byRange.total).toBe(1);

    const combined = await searchEntries(userId, {
      q: "migration",
      type: "work",
      mood: "anxious",
      tag: "erp",
    });
    expect(combined.total).toBe(1);
  });

  it("returns an empty result rather than an error when nothing matches", async () => {
    const result = await searchEntries(userId, { q: "nonexistent-topic" });
    expect(result.total).toBe(0);
    expect(result.hits).toEqual([]);
  });

  it("reports first and last mention with counts", async () => {
    await createEntry(userId, TZ, {
      content: "credit limit still unresolved",
      occurredAt: at("2026-09-20T04:00:00Z"),
    });

    const stats = await mentionStats(userId, "credit limit");
    expect(stats?.mentions).toBe(2);
    expect(stats?.firstMention?.day).toBe("2026-03-04");
    expect(stats?.lastMention?.day).toBe("2026-09-20");
  });
});

describe("memory graph", () => {
  it("surfaces related older entries with a reason", async () => {
    const older = await createEntry(userId, TZ, {
      content: "The credit limit project started today with a schema review.",
      tags: ["work"],
      occurredAt: at("2026-03-01T04:00:00Z"),
    });
    const newer = await createEntry(userId, TZ, {
      content: "Credit limit project finally went live after the schema review.",
      tags: ["work"],
      occurredAt: at("2026-09-01T04:00:00Z"),
    });

    const related = await relatedMemories(userId, {
      id: newer.id,
      content: newer.content,
      day: newer.day,
      tags: newer.tags,
      threads: [],
    });

    expect(related.map((r) => r.entry.id)).toContain(older.id);
    expect(related[0].reason).toBeTruthy();
    // It never links an entry to itself.
    expect(related.map((r) => r.entry.id)).not.toContain(newer.id);
  });

  it("only resurfaces entries older than the minimum age", async () => {
    await createEntry(userId, TZ, { content: "yesterday", occurredAt: at("2026-09-27T04:00:00Z") });
    expect(await randomMemory(userId, { minAgeDays: 30 })).toBeNull();

    const old = await createEntry(userId, TZ, {
      content: "long ago",
      occurredAt: at("2025-01-01T04:00:00Z"),
    });
    const memory = await randomMemory(userId, { minAgeDays: 30 });
    expect(memory?.entry.id).toBe(old.id);
  });

  it("returns null instead of an empty memory when there is nothing", async () => {
    expect(await randomMemory(userId)).toBeNull();
  });

  it("flags threads that went quiet instead of ones still active", async () => {
    const quiet = await prisma.thread.create({
      data: { userId, name: "Fitness", slug: "fitness" },
    });
    const active = await prisma.thread.create({
      data: { userId, name: "Work", slug: "work" },
    });

    for (const day of ["2025-01-10", "2025-02-10", "2025-03-10"]) {
      await createEntry(userId, TZ, {
        content: `fitness note ${day}`,
        threadIds: [quiet.id],
        occurredAt: at(`${day}T04:00:00Z`),
      });
    }
    await createEntry(userId, TZ, {
      content: "work today",
      threadIds: [active.id],
      occurredAt: at("2026-09-27T04:00:00Z"),
    });

    const ghosts = await ghostThreads(userId, "2026-09-28");
    expect(ghosts.map((g) => g.slug)).toEqual(["fitness"]);
    expect(ghosts[0].gapDays).toBeGreaterThan(500);
  });

  it("counts a thread's mentions and first/last date", async () => {
    const thread = await prisma.thread.create({
      data: { userId, name: "Career", slug: "career" },
    });
    for (const day of ["2026-01-15", "2026-05-15", "2026-09-15"]) {
      await createEntry(userId, TZ, {
        content: `career note ${day}`,
        threadIds: [thread.id],
        occurredAt: at(`${day}T04:00:00Z`),
      });
    }

    const threads = await lifeThreads(userId);
    const career = threads.find((t) => t.slug === "career");
    expect(career?.mentions).toBe(3);
    expect(career?.first).toBe("2026-01-15");
    expect(career?.last).toBe("2026-09-15");
    expect(career?.byMonth).toHaveLength(3);
  });

  it("reports a perspective change without judging either side", async () => {
    const thread = await prisma.thread.create({
      data: { userId, name: "Running", slug: "running" },
    });
    await createEntry(userId, TZ, {
      content: "I hate running, it's awful and I feel stuck.",
      threadIds: [thread.id],
      occurredAt: at("2026-01-01T04:00:00Z"),
    });
    await createEntry(userId, TZ, {
      content: "I actually enjoy running now, it feels great and worth it.",
      threadIds: [thread.id],
      occurredAt: at("2026-06-01T04:00:00Z"),
    });

    const shifts = await perspectiveShifts(userId);
    expect(shifts).toHaveLength(1);
    expect(shifts[0].thread).toBe("Running");
    expect(shifts[0].before.day).toBe("2026-01-01");
    expect(shifts[0].after.day).toBe("2026-06-01");
  });

  it("does not call a same-month tone change a shift", async () => {
    const thread = await prisma.thread.create({
      data: { userId, name: "Diet", slug: "diet" },
    });
    await createEntry(userId, TZ, {
      content: "hate this diet, awful",
      threadIds: [thread.id],
      occurredAt: at("2026-01-01T04:00:00Z"),
    });
    await createEntry(userId, TZ, {
      content: "enjoy this diet, great",
      threadIds: [thread.id],
      occurredAt: at("2026-01-20T04:00:00Z"),
    });
    expect(await perspectiveShifts(userId)).toHaveLength(0);
  });
});

describe("insights", () => {
  beforeEach(async () => {
    await createEntry(userId, TZ, {
      content: "a b c d e f g h i j",
      tags: ["work"],
      mood: "good",
      occurredAt: at("2026-09-26T04:00:00Z"),
      entryType: "work",
    });
    await createEntry(userId, TZ, {
      content: "short",
      tags: ["work"],
      mood: "low",
      occurredAt: at("2026-09-27T04:00:00Z"),
      entryType: "reflection",
    });
    await createEntry(userId, TZ, {
      content: "another note here",
      tags: ["health"],
      occurredAt: at("2026-09-28T04:00:00Z"),
      entryType: "personal",
    });
  });

  it("reports totals, tags, moods and cadence from stored rows", async () => {
    const report = await insights(userId, "2026-09-28");
    expect(report.totals.entries).toBe(3);
    expect(report.totals.words).toBe(10 + 1 + 3);
    expect(report.totals.longestEntry?.words).toBe(10);
    expect(report.topTags[0]).toEqual({ slug: "work", name: "work", count: 2 });
    expect(report.cadence.thisWeek).toBe(3);
    expect(report.cadence.activeDays30).toBe(3);
    expect(report.moodCounts.map((m) => m.mood).sort()).toEqual(["good", "low"]);
    expect(report.streaks.longest).toBe(3);
    expect(report.streaks.longestRange).toEqual({ from: "2026-09-26", to: "2026-09-28" });
    expect(report.byHour).toHaveLength(24);
  });

  it("flags a silent period after the last written day", async () => {
    const report = await insights(userId, "2026-10-05");
    expect(report.cadence.silenceDays?.since).toBe("2026-09-29");
  });

  it("builds reflection facts the AI layer is allowed to cite", async () => {
    const facts = await reflectionFacts(userId, "2026-09-28", "week");
    expect(facts.entryCount).toBe(3);
    expect(facts.from).toBe("2026-09-22");
    expect(facts.citedEntries).toHaveLength(3);
    expect(facts.threads).toEqual([]);
  });

  it("returns a dense heatmap of activity levels", async () => {
    const cells = await activityHeatmap(userId, "2026-09-28", 30);
    expect(cells).toHaveLength(30);
    expect(cells[cells.length - 1].day).toBe("2026-09-28");
    expect(cells[cells.length - 1].level).toBe(1);
    expect(cells[0].level).toBe(0);
  });
});

describe("notifications outbox", () => {
  it("queues an entry notification with a preview but no raw dump", async () => {
    await createEntry(userId, TZ, {
      content: "Private thought that should never be logged verbatim in errors.",
      occurredAt: at("2026-09-28T04:00:00Z"),
    });

    const rows = await prisma.notificationOutbox.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("entry.created");
    const payload = JSON.parse(rows[0].payload) as { preview: string; day: string };
    expect(payload.day).toBe("2026-09-28");
    expect(payload.preview.length).toBeLessThanOrEqual(221);
  });

  it("stays silent when the user turned entry notifications off", async () => {
    await prisma.userSettings.update({
      where: { userId },
      data: { notifyOnEntry: false },
    });
    await createEntry(userId, TZ, { content: "quiet" });
    expect(await prisma.notificationOutbox.count({ where: { userId } })).toBe(0);
  });
});
