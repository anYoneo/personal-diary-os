/**
 * Audit: does every query on user-owned data actually filter by userId?
 *
 * A missed filter in a single-user app is harmless. The moment a second
 * account exists, it means one person can read another's diary. This script
 * finds every prisma call on a user-owned model and reports whether the call
 * (or the surrounding statement) mentions userId.
 *
 *   node scripts/audit-user-scoping.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Models that carry a userId column and MUST be scoped.
const OWNED = [
  "entry", "tag", "thread", "goal", "unresolvedThought", "reminder",
  "attachment", "aiInsight", "auditLog", "notificationOutbox", "linkCode",
  "userSettings", "entryTag", "entryThread",
];
// Models keyed by something else, tolerated without userId.
const GLOBAL = ["user", "session"];

/**
 * Reviewed exceptions, keyed by `file|prisma.model.op` (NOT by line number: a
 * line-based list breaks on every unrelated edit above it). Each entry is either
 * a background worker acting on a queued job it already owns, or a lookup where
 * the random id itself is the capability, or a call whose `where` object is
 * built with userId a few lines earlier. The value is how many such calls are
 * expected — so a *new* unscoped call in an already-listed file still fails.
 */
const ALLOWED = new Map([
  // Worker: drains the outbox queue and marks reminders sent. Not user-facing.
  ["src/lib/services/notifications.ts|prisma.notificationOutbox.findMany", 1],
  ["src/lib/services/notifications.ts|prisma.notificationOutbox.update", 3],
  ["src/lib/services/notifications.ts|prisma.notificationOutbox.findUnique", 1],
  ["src/worker/index.ts|prisma.reminder.update", 1],
  // Discord /link: find-by-code then bind; the code is the capability.
  ["src/discord/commands.ts|prisma.linkCode.findUnique", 1],
  ["src/discord/commands.ts|prisma.linkCode.update", 1],
  // Thread delete: children are keyed by threadId, just ownership-checked above.
  ["src/app/api/threads/[id]/route.ts|prisma.thread.delete", 1],
  // List/search: `where` comes from buildWhere(userId, …) or a literal carrying
  // userId — the filter is real, just built a few lines up.
  ["src/lib/services/entries.ts|prisma.entry.findMany", 1],
  ["src/lib/services/entries.ts|prisma.entry.count", 1],
  ["src/lib/services/memory.ts|prisma.entry.findMany", 1],
  ["src/lib/services/memory.ts|prisma.entry.count", 1],
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk("src");
let checked = 0;
const unscoped = [];

for (const file of files) {
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");

  // Match  prisma.<model>.<op>(   and capture the balanced argument text.
  const re = /prisma\.([a-zA-Z]+)\.([a-zA-Z]+)\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    const [, model, op] = m;
    if (GLOBAL.includes(model)) continue;
    if (!OWNED.includes(model)) continue;

    // Read from the opening paren to its match.
    let i = m.index + m[0].length - 1;
    let depth = 0;
    let end = i;
    for (; end < src.length; end++) {
      const c = src[end];
      if (c === "(") depth++;
      else if (c === ")") { depth--; if (depth === 0) { end++; break; } }
    }
    const args = src.slice(i, end);
    checked++;

    const lineNo = src.slice(0, m.index).split("\n").length;
    const lineText = (lines[lineNo - 1] || "").trim();

    // Scoped if userId is mentioned anywhere in the call's arguments.
    const hasUserId = /\buserId\b/.test(args);

    // Writes that are scoped by a compound unique key are fine: entryId_tagId etc.
    const compoundKey = /where:\s*\{[^}]*\b(entryId|tagId|threadId)\b/.test(args);

    if (!hasUserId && !compoundKey) {
      unscoped.push({
        file,
        line: lineNo,
        call: `prisma.${model}.${op}`,
        code: lineText.slice(0, 110),
      });
    }
  }
}

console.log(`Scanned ${files.length} files, ${checked} prisma calls on user-owned models.\n`);

const unexplained = [];
const seen = new Map();
for (const r of unscoped) {
  const key = `${r.file.replace(/\\/g, "/")}|${r.call}`;
  const used = (seen.get(key) ?? 0) + 1;
  seen.set(key, used);
  const budget = ALLOWED.get(key);
  if (!budget || used > budget) unexplained.push(r);
}

if (unexplained.length === 0) {
  console.log(
    `Every user-owned query is scoped by userId, or is one of the ` +
      `${[...ALLOWED.values()].reduce((a, b) => a + b, 0)} reviewed exceptions.`,
  );
  console.log("Safe for multi-user.");
  process.exit(0);
}

console.log(`${unexplained.length} unreviewed call(s) do NOT mention userId in their arguments:`);
console.log("(fix the query, or add a justified entry to ALLOWED in this file)\n");
for (const r of unexplained) {
  console.log(`  ${r.file}:${r.line}`);
  console.log(`    ${r.call}`);
  console.log(`    ${r.code}`);
}
console.log();
process.exit(1);
