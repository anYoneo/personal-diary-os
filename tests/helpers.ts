import { PrismaClient, Prisma } from "@prisma/client";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Test database bootstrap. Uses a throwaway SQLite file so tests never touch the
 * real diary, and never requires Docker or a running Postgres.
 */

const TEST_DB = resolve(process.cwd(), "prisma/test.db");
process.env.DATABASE_URL = `file:${TEST_DB}`;
process.env.USER_TIMEZONE = "Asia/Jakarta";

export function envFile(): void {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    for (const line of raw.split("\n")) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match) process.env[match[1]] ??= match[2].replace(/^"|"$/g, "");
    }
  } catch {
    // .env is optional in tests.
  }
}

export function pushSchema(): void {
  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: `file:${TEST_DB}` },
  });
}

export function testClient(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: `file:${TEST_DB}` } } });
}

export async function resetDb(prisma: PrismaClient): Promise<void> {
  // Order matters: children before parents (SQLite has no cascade on deleteMany).
  await prisma.$transaction([
    prisma.entryTag.deleteMany(),
    prisma.entryThread.deleteMany(),
    prisma.attachment.deleteMany(),
    prisma.aiInsight.deleteMany(),
    prisma.notificationOutbox.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.unresolvedThought.deleteMany(),
    prisma.goal.deleteMany(),
    prisma.entry.deleteMany(),
    prisma.tag.deleteMany(),
    prisma.thread.deleteMany(),
    prisma.reminder.deleteMany(),
    prisma.linkCode.deleteMany(),
    prisma.discordLink.deleteMany(),
    prisma.userSettings.deleteMany(),
    prisma.session.deleteMany(),
    prisma.signupCode.deleteMany(),
    prisma.user.deleteMany(),
  ] as unknown as Prisma.PrismaPromise<unknown>[]);
}

export async function makeUser(prisma: PrismaClient, email = "test@example.com") {
  return prisma.user.create({
    data: {
      email,
      name: "Test",
      passwordHash: "scrypt$deadbeef$00",
      timezone: "Asia/Jakarta",
      settings: { create: { timezone: "Asia/Jakarta" } },
    },
  });
}
