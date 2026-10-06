/**
 * Proves the save-race diagnosis against a real server.
 *
 * The report: while writing, a save ate part of the text and then the Save button
 * stopped working. The mechanism was two overlapping PATCHes carrying the same
 * `expectedVersion`; the server correctly rejects the second, and the editor
 * latched that as a conflict.
 *
 * This script makes that visible: login → create an entry → fire the same
 * concurrent pair → print the statuses. Then it does what the fixed client does
 * (wait for the first to finish before the second) and shows it succeeding.
 *
 *   node scripts/verify-save-race.mjs            # against http://localhost:3111
 *   BASE_URL=... node scripts/verify-save-race.mjs
 *
 * The password is read from .env and is never printed.
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const base = (process.env.BASE_URL ?? "http://localhost:3111").replace(/\/+$/, "");

function envValue(key) {
  const raw = readFileSync(new URL("../.env", import.meta.url), "utf8");
  const line = raw.split(/\r?\n/).find((l) => l.trim().startsWith(`${key}=`));
  if (!line) return "";
  return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
}

const email = envValue("ADMIN_EMAIL");
const password = envValue("ADMIN_PASSWORD");
if (!email || !password) {
  console.error("ADMIN_EMAIL / ADMIN_PASSWORD missing from .env");
  process.exit(1);
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

let cookie = "";
async function call(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(options.headers ?? {}),
    },
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

const login = await call("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ email, password }),
});
check("login succeeds", login.status === 200, `HTTP ${login.status}`);
if (login.status !== 200) {
  console.log("\nCannot continue without a session.");
  process.exit(1);
}

// A scratch entry, deleted at the end.
const created = await call("/api/entries", {
  method: "POST",
  body: JSON.stringify({ content: "save-race probe — safe to delete", source: "web" }),
});
check("entry created", created.status === 201, `HTTP ${created.status}`);
const id = created.body?.data?.id;
const version = created.body?.data?.version;
if (!id) {
  console.log("\nNo entry id; aborting.");
  process.exit(1);
}
console.log(`  entry ${id} at version ${version}`);

// --- The bug: two PATCHes with the same expectedVersion, at the same time. ---
const [a, b] = await Promise.all([
  call(`/api/entries/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ content: "first writer", expectedVersion: version }),
  }),
  call(`/api/entries/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ content: "second writer", expectedVersion: version }),
  }),
]);
const statuses = [a.status, b.status].sort();
check(
  "concurrent identical saves: one wins, one is refused (the reported failure)",
  statuses[0] === 200 && statuses[1] === 409,
  `got ${statuses.join(" + ")}`,
);

// --- What the fixed client does: the queue serialises them. ---
const fresh = await call(`/api/entries/${id}`);
const v2 = fresh.body?.data?.version;
const first = await call(`/api/entries/${id}`, {
  method: "PATCH",
  body: JSON.stringify({ content: "queued first", expectedVersion: v2 }),
});
const v3 = first.body?.data?.version;
const second = await call(`/api/entries/${id}`, {
  method: "PATCH",
  body: JSON.stringify({ content: "queued second", expectedVersion: v3 }),
});
check(
  "serialised saves both succeed (the fix)",
  first.status === 200 && second.status === 200,
  `got ${first.status} then ${second.status}`,
);

// The final text is what the user last typed — nothing silently overwritten.
const finalRead = await call(`/api/entries/${id}`);
check(
  "the last payload is what is stored",
  finalRead.body?.data?.content === "queued second",
  JSON.stringify(finalRead.body?.data?.content),
);

// Clean up the probe so the diary is left as it was.
const prisma = new PrismaClient();
await prisma.entry.deleteMany({ where: { id } });
await prisma.$disconnect();
console.log("\n  (probe entry removed)");

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
