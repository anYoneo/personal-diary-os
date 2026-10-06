import { PrismaClient } from "@prisma/client";

/**
 * Single Prisma client for the process. Next dev hot-reloads modules, so the
 * instance is cached on globalThis to avoid exhausting SQLite connections.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Diary content is never logged. Only warnings/errors, and queries are excluded.
    log: [{ emit: "stdout", level: "warn" }, { emit: "stdout", level: "error" }],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/**
 * SQLite durability settings, tuned for this host.
 *
 * Measured on the VPS: a single insert+delete took 2.8–15 s, while reads stayed
 * at 1–22 ms. The cause was `PRAGMA synchronous=FULL`, the SQLite default: every
 * commit does an fsync + an unlink, and this VM's disk takes ~2.7 s per fsync.
 * A login (one session insert) therefore took 23 s from outside; the same
 * insert with `synchronous=NORMAL` took 5–6 ms — a ~1000× difference.
 *
 * `NORMAL` is the mode SQLite itself documents as the right choice for WAL
 * (https://sqlite.org/wal.html): commits survive an application crash, and the
 * database cannot be corrupted. The only exposure is losing the last few
 * committed transactions if the *machine* loses power mid-write. For a personal
 * diary on a small VPS, trading that for a usable save button is the correct
 * call — and it is the difference between the app feeling broken and feeling
 * instant.
 *
 * Set DIARY_SQLITE_SYNCHRONOUS=FULL to restore the strict setting.
 *
 * Applied once per process: the pool is limited to a single connection
 * (connection_limit=1 in DATABASE_URL), so the statement below pins the mode for
 * every later query on this process. The worker and bot import this module too,
 * so they get the same treatment.
 */
export const dbReady: Promise<void> = (async () => {
  const mode = (process.env.DIARY_SQLITE_SYNCHRONOUS ?? "NORMAL").toUpperCase();
  if (mode !== "NORMAL" && mode !== "FULL") {
    // Anything else is a typo; keep the fast, documented-safe default.
    process.stdout.write(`[db] ignoring DIARY_SQLITE_SYNCHRONOUS=${mode}\n`);
  }
  const wanted = mode === "FULL" ? "FULL" : "NORMAL";
  try {
    // PRAGMA returns a row, so this goes through $queryRawUnsafe rather than
    // $executeRawUnsafe (which expects an affected-row count).
    await prisma.$queryRawUnsafe(`PRAGMA synchronous=${wanted}`);
    // With a 1-connection pool, a blocked writer is the only way to fail loudly;
    // make contention wait rather than error out.
    await prisma.$queryRawUnsafe("PRAGMA busy_timeout=30000");
  } catch (error) {
    // Never take the app down over a tuning statement.
    process.stderr.write(`[db] could not apply pragmas: ${String(error)}\n`);
    return;
  }
  if (process.env.DIARY_SQLITE_DEBUG === "1") {
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      "PRAGMA synchronous",
    );
    process.stdout.write(`[db] synchronous=${JSON.stringify(rows)}\n`);
  }
})();
