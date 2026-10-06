import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { envFile, pushSchema, makeUser } from "./helpers";
import {
  createEntry,
  updateEntry,
  softDeleteEntry,
  restoreEntry,
  purgeEntry,
  listEntries,
  entriesForDay,
} from "@/lib/services/entries";
import { searchEntries } from "@/lib/services/memory";
import { prisma } from "@/lib/db";
import { newInviteCode, normalizeInviteCode } from "@/lib/crypto";

/**
 * Multi-user isolation.
 *
 * The app started single-user, where a missing `userId` filter was invisible.
 * Adding registration makes any unfiltered query a real leak: one account
 * reading another person's diary. These tests exist to keep that from ever
 * being true again — they assert on the *behaviour* (what B can see and touch),
 * not on the shape of the query, so a refactor that keeps the guarantee keeps
 * passing.
 */
const TZ = "Asia/Jakarta";
let A = "";
let B = "";

async function wipe() {
  const order = [
    "entryTag", "entryThread", "attachment", "aiInsight", "notificationOutbox",
    "auditLog", "unresolvedThought", "goal", "entry", "tag", "thread",
    "reminder", "linkCode", "discordLink", "userSettings", "session", "signupCode", "user",
  ] as const;
  for (const model of order) {
    // @ts-expect-error dynamic delegate access in tests
    await prisma[model].deleteMany();
  }
}

beforeAll(() => {
  envFile();
  pushSchema();
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await wipe();
  const a = await makeUser(prisma, "a@example.com");
  const b = await makeUser(prisma, "b@example.com");
  A = a.id;
  B = b.id;
});

describe("entry isolation", () => {
  it("never lists another user's entries", async () => {
    await createEntry(A, TZ, { content: "A private thought about the marina" });
    await createEntry(B, TZ, { content: "B private thought about the marina" });

    const forA = await listEntries(A, { limit: 50, order: "desc" } as never);
    const forB = await listEntries(B, { limit: 50, order: "desc" } as never);

    expect(forA.items).toHaveLength(1);
    expect(forB.items).toHaveLength(1);
    expect(forA.total).toBe(1);
    expect(forA.items[0].content).toContain("A private thought");
    expect(forB.items[0].content).toContain("B private thought");
  });

  it("refuses to read, edit, delete, restore or purge another user's entry", async () => {
    const mine = await createEntry(A, TZ, { content: "Only mine" });

    // B is a valid, authenticated user — just not the owner.
    await expect(updateEntry(B, mine.id, { content: "hijacked" })).rejects.toThrow();
    await expect(softDeleteEntry(B, mine.id)).rejects.toThrow();
    await expect(purgeEntry(B, mine.id)).rejects.toThrow();

    // And the entry is untouched.
    const still = await prisma.entry.findUnique({ where: { id: mine.id } });
    expect(still?.content).toBe("Only mine");
    expect(still?.deletedAt).toBeNull();

    // A soft-deleted entry cannot be restored by the wrong user either.
    await softDeleteEntry(A, mine.id);
    await expect(restoreEntry(B, mine.id)).rejects.toThrow();
    // ...but the owner still can.
    await restoreEntry(A, mine.id);
    const back = await prisma.entry.findUnique({ where: { id: mine.id } });
    expect(back?.deletedAt).toBeNull();
  });

  it("keeps search results scoped to the searcher", async () => {
    await createEntry(A, TZ, { content: "The word lighthouse belongs to A" });
    await createEntry(B, TZ, { content: "The word lighthouse belongs to B" });

    const hitsA = await searchEntries(A, { q: "lighthouse", limit: 50 });
    const hitsB = await searchEntries(B, { q: "lighthouse", limit: 50 });

    const textA = hitsA.hits.map((h) => `${h.title} ${h.excerpt}`).join(" ");
    const textB = hitsB.hits.map((h) => `${h.title} ${h.excerpt}`).join(" ");

    expect(textA).toContain("belongs to A");
    expect(textA).not.toContain("belongs to B");
    expect(textB).toContain("belongs to B");
    expect(textB).not.toContain("belongs to A");
  });

  it("keeps the day view scoped to the viewer", async () => {
    await createEntry(A, TZ, { content: "A today" });
    await createEntry(B, TZ, { content: "B today" });

    const day = (await listEntries(A, { limit: 1, order: "desc" } as never)).items[0].day;
    const dayA = await entriesForDay(A, day);
    const dayB = await entriesForDay(B, day);

    expect(dayA.map((e) => e.content)).toEqual(["A today"]);
    expect(dayB.map((e) => e.content)).toEqual(["B today"]);
  });

  it("keeps tags per-user even when the tag name collides", async () => {
    await createEntry(A, TZ, { content: "one", tags: ["Work"] });
    await createEntry(B, TZ, { content: "two", tags: ["Work"] });

    const tagsA = await prisma.tag.findMany({ where: { userId: A } });
    const tagsB = await prisma.tag.findMany({ where: { userId: B } });
    expect(tagsA).toHaveLength(1);
    expect(tagsB).toHaveLength(1);
    expect(tagsA[0].id).not.toBe(tagsB[0].id);
    expect(tagsA[0].slug).toBe(tagsB[0].slug);
  });
});

describe("invite codes", () => {
  it("mints codes that survive a round trip through user input", () => {
    for (let i = 0; i < 50; i++) {
      const code = newInviteCode();
      expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      expect(normalizeInviteCode(code)).toBe(code);
      expect(normalizeInviteCode(code.toLowerCase())).toBe(code);
      expect(normalizeInviteCode(code.replace("-", " "))).toBe(code);
      // Never ambiguous characters.
      expect(code).not.toMatch(/[O0I1]/);
    }
  });

  it("lets only one of three simultaneous sign-ups claim a single-use code", async () => {
    const code = newInviteCode();
    await prisma.signupCode.create({ data: { code, maxUses: 1, usedCount: 0 } });

    // Mirrors the register route: read, then a conditional update whose version
    // predicate is what makes the claim atomic.
    const attempt = async () => {
      const invite = await prisma.signupCode.findUnique({ where: { code } });
      if (!invite || invite.usedCount >= invite.maxUses) return false;
      const claimed = await prisma.signupCode.updateMany({
        where: { id: invite.id, usedCount: invite.usedCount, expiresAt: invite.expiresAt },
        data: { usedCount: { increment: 1 } },
      });
      return claimed.count === 1;
    };

    const results = await Promise.all([attempt(), attempt(), attempt()]);
    expect(results.filter(Boolean)).toHaveLength(1);

    const after = await prisma.signupCode.findUnique({ where: { code } });
    expect(after?.usedCount).toBe(1);
  });

  it("counts multiple uses up to the limit", async () => {
    const code = newInviteCode();
    await prisma.signupCode.create({ data: { code, maxUses: 2, usedCount: 0 } });

    const claim = () =>
      prisma.signupCode.updateMany({
        where: { code, usedCount: { lt: 2 } },
        data: { usedCount: { increment: 1 } },
      });

    expect((await claim()).count).toBe(1);
    expect((await claim()).count).toBe(1);
    expect((await claim()).count).toBe(0);
  });
});
