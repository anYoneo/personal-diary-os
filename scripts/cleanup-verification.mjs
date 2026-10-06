/**
 * Removes ONLY rows created by manual/scripted verification runs:
 *   - entries whose body starts with the known test marker
 *   - the throwaway `probe@local` account registered to exercise the editor
 *   - every notification outbox row
 *   - every spent link code
 *
 * Leaves seeded threads, goals, thoughts and any real diary entry untouched.
 * The DiscordLink row is intentionally preserved — it is the account link that
 * makes notifications work, not test debris. Use DELETE /api/discord/link or
 * the Settings page to remove it.
 *
 * An entry belonging to a real account is NEVER deleted by this script, however
 * short it looks: the "y" that a click-through captured during the save-race
 * work is the owner's own row, not debris. Only a named marker makes a row
 * disposable here.
 *
 *   node scripts/cleanup-verification.mjs
 */
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

const MARKERS = [
  "Discord delivery check",
  "Smoke test entry",
  "smoke-test",
  "save-race probe",
];

const before = await p.entry.count();

// Match on body text; tags are a relation, so they can't be filtered directly.
const doomed = await p.entry.findMany({
  where: { OR: MARKERS.map((m) => ({ content: { contains: m } })) },
  select: { id: true },
});
if (doomed.length) {
  await p.entry.deleteMany({ where: { id: { in: doomed.map((e) => e.id) } } });
}

// The throwaway account used for end-to-end editor checks.
const probe = await p.user.findFirst({ where: { email: "probe@local" } });
if (probe) {
  await p.session.deleteMany({ where: { userId: probe.id } });
  await p.userSettings.deleteMany({ where: { userId: probe.id } });
  await p.auditLog.deleteMany({ where: { userId: probe.id } });
  await p.entry.deleteMany({ where: { userId: probe.id } });
  await p.user.delete({ where: { id: probe.id } });
}

const outbox = await p.notificationOutbox.deleteMany({});
const codes = await p.linkCode.deleteMany({});

console.log(
  `deleted — entries ${before - (await p.entry.count())}, outbox ${outbox.count}, link codes ${codes.count}`,
);
console.log(
  `remaining — entries ${await p.entry.count()}, goals ${await p.goal.count()}, thoughts ${await p.unresolvedThought.count()}, threads ${await p.thread.count()}, discord links ${await p.discordLink.count()}`,
);

// What the diary looks like afterwards, so an accidental deletion is visible.
for (const u of await p.user.findMany({ select: { email: true } })) {
  console.log(`  account ${u.email}`);
}
for (const e of await p.entry.findMany({ select: { content: true, wordCount: true, version: true } })) {
  console.log(`    entry ${e.content.length} chars, ${e.wordCount} words, v${e.version}`);
}

await p.$disconnect();
