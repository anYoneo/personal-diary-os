/**
 * Idempotent database initialisation for a fresh host.
 *
 *   node scripts/deploy-migrate.mjs
 *
 * Safe to run on every deploy:
 *   - makes sure the directory holding the SQLite file exists
 *   - creates/syncs every table (`prisma db push`)
 *   - seeds the owner account, but ONLY when it does not already exist
 *
 * It never touches existing rows, so a redeploy cannot wipe the diary.
 *
 * Environment:
 *   DATABASE_URL      e.g. "file:/data/diary.db"  (required)
 *   ADMIN_EMAIL       owner login                 (required unless already seeded)
 *   ADMIN_PASSWORD    owner password              (required unless already seeded)
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

// The worker/bot entry points load .env themselves; this script runs before any
// of them, so load it here too when a .env is present.
try {
  const { config } = await import("dotenv");
  config({ quiet: true });
} catch {
  // dotenv is optional here — CI may pass real environment variables instead.
}

const url = process.env.DATABASE_URL ?? process.env.DIARY_DATA_DIR
  ? (process.env.DATABASE_URL ?? `file:${(process.env.DIARY_DATA_DIR ?? "").replace(/\/$/, "")}/diary.db`)
  : "";

if (!url) {
  console.error(
    "Set DATABASE_URL (e.g. file:/data/diary.db) or DIARY_DATA_DIR (the script then\n"
      + "uses <DIARY_DATA_DIR>/diary.db).",
  );
  process.exit(1);
}
// The Prisma client reads DATABASE_URL directly, so make sure it is set even when
// the value was derived from DIARY_DATA_DIR.
process.env.DATABASE_URL = url;

// Run the CLIs through the SAME node binary that is executing this script,
// instead of shelling out to `npx`. `npx` is a `.cmd` shim on Windows, which
// execFileSync cannot launch without a shell; this form works on every platform
// and always uses the project's own local tool versions.
const prismaCli = path.join("node_modules", "prisma", "build", "index.js");
const tsxCli = path.join("node_modules", "tsx", "dist", "cli.mjs");
const runNode = (script, args) => execFileSync(process.execPath, [script, ...args], { stdio: "inherit" });

// `file:./x.db` is relative to the prisma/ directory; absolute paths are used
// as-is (that is what the container passes, so the file lands on the volume).
if (url.startsWith("file:")) {
  const raw = url.slice("file:".length);
  const resolved = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), "prisma", raw);
  const dir = path.dirname(resolved);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    console.log(`Created data directory ${dir}`);
  }
  console.log(`Database file: ${resolved}`);
}

console.log("Applying schema (prisma db push)…");
runNode(prismaCli, ["db", "push", "--skip-generate"]);

const prisma = new PrismaClient();
try {
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  if (!email) {
    console.log("ADMIN_EMAIL not set — skipping seed.");
  } else {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      console.log(`Owner ${email} already exists — leaving the diary untouched.`);
    } else {
      console.log("Seeding the owner account…");
      runNode(tsxCli, ["scripts/seed.ts"]);
    }
  }

  const counts = {
    users: await prisma.user.count(),
    entries: await prisma.entry.count(),
    threads: await prisma.thread.count(),
  };
  console.log(`Ready — users ${counts.users}, entries ${counts.entries}, threads ${counts.threads}`);
} finally {
  await prisma.$disconnect();
}
