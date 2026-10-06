import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Runs ONCE for the whole test run: throws away the previous test database and
 * pushes the current schema into it. Tests run against a throwaway SQLite file
 * so the real diary (prisma/dev.db) is never touched.
 */
export default function globalSetup() {
  const dbFile = resolve(process.cwd(), "prisma/test.db");
  if (existsSync(dbFile)) rmSync(dbFile);

  process.env.DATABASE_URL = "file:./test.db";
  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
  });
}
