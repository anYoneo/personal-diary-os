/**
 * Removes every row created by scripts/smoke.mjs so a test run never leaves
 * trace data in the real diary. Threads are matched by their "Smoke " prefix,
 * entries by source=web with no tags, and the notification outbox is emptied
 * only of rows that were never delivered.
 *
 *   node scripts/reset-smoke.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// DATABASE_URL is not auto-loaded outside Next, so read .env directly.
const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath) && !process.env.DATABASE_URL) {
  const text = fs.readFileSync(envPath, "utf8");
  const match = /^DATABASE_URL="?([^"\r\n]*)"?/m.exec(text);
  if (match) process.env.DATABASE_URL = match[1];
}

const removed = {};

removed.entries = (
  await prisma.entry.deleteMany({
    where: {
      source: "web",
      deletedAt: null,
      tags: { none: {} },
      attachments: { none: {} },
    },
  })
).count;

removed.thoughts = (
  await prisma.unresolvedThought.deleteMany({
    where: { question: { startsWith: "Should I learn TOGAF" } },
  })
).count;

removed.goals = (
  await prisma.goal.deleteMany({ where: { title: { contains: "Ship the diary" } } })
).count;

removed.threads = (
  await prisma.thread.deleteMany({ where: { name: { startsWith: "Smoke Thread" } } })
).count;

removed.audit = (
  await prisma.auditLog.deleteMany({
    where: { action: { in: ["goal.update", "goal.delete", "thought.update", "thought.delete"] } },
  })
).count;

removed.outbox = (
  await prisma.notificationOutbox.deleteMany({ where: { status: { in: ["skipped", "pending"] } } })
).count;

removed.staleTags = (await prisma.tag.deleteMany({ where: { entries: { none: {} } } })).count;

const remaining = {
  entries: await prisma.entry.count(),
  goals: await prisma.goal.count(),
  thoughts: await prisma.unresolvedThought.count(),
  threads: await prisma.thread.count(),
  outbox: await prisma.notificationOutbox.count(),
};

console.log(JSON.stringify({ removed, remaining }, null, 2));
await prisma.$disconnect();
