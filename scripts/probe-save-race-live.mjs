/**
 * Probes the DEPLOYED server for the save-race behaviour, over public HTTPS.
 *
 * Runs against APP_URL from the repo's .env. Prints each step as it happens and
 * puts a timeout on every request, so a hang shows up as a failure instead of a
 * silent stall (dalang's exec channel made the in-VM script look like it hung).
 *
 * The probe entry is tagged with "save-race probe" so the repo's
 * cleanup-verification.mjs removes it on the next pass.
 *
 *   node scripts/probe-save-race-live.mjs
 */
import { readFileSync } from "node:fs";

const envPath = new URL("../.env", import.meta.url);
const raw = readFileSync(envPath, "utf8");
function envValue(key) {
  const line = raw.split(/\r?\n/).find((l) => l.trim().startsWith(`${key}=`));
  return line ? line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "") : "";
}

const base = (process.env.PROBE_BASE_URL || envValue("APP_URL") || "http://localhost:3111").replace(
  /\/+$/,
  "",
);
const email = envValue("ADMIN_EMAIL");
const password = envValue("ADMIN_PASSWORD");
if (!email || !password) {
  console.error("ADMIN_EMAIL / ADMIN_PASSWORD missing from .env");
  process.exit(1);
}

let cookie = "";
async function call(path, options = {}) {
  const started = Date.now();
  try {
    const response = await fetch(`${base}${path}`, {
      ...options,
      signal: AbortSignal.timeout(20000),
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
    return { status: response.status, body, ms: Date.now() - started };
  } catch (error) {
    return { status: 0, body: String(error), ms: Date.now() - started };
  }
}

const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

console.log(`target ${base}\n`);

const login = await call("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ email, password }),
});
check("login succeeds", login.status === 200, `HTTP ${login.status} in ${login.ms}ms`);
if (login.status !== 200) process.exit(1);

const created = await call("/api/entries", {
  method: "POST",
  body: JSON.stringify({
    content: "save-race probe — safe to delete",
    source: "web",
  }),
});
check("entry created", created.status === 201, `HTTP ${created.status} in ${created.ms}ms`);
const id = created.body?.data?.id;
const version = created.body?.data?.version;
if (!id) {
  console.log("\nno entry id; aborting");
  process.exit(1);
}
console.log(`  entry ${id} at version ${version}\n`);

// --- The reported failure: two overlapping saves, same expectedVersion. ---
console.log("firing two concurrent PATCHes with the same expectedVersion…");
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
const statuses = [a.status, b.status].sort((x, y) => x - y);
console.log(`  statuses ${a.status} (${a.ms}ms) and ${b.status} (${b.ms}ms)`);
check(
  "exactly one of two simultaneous saves wins, the other is refused",
  statuses[0] === 200 && statuses[1] === 409,
  `got ${statuses.join(" + ")}`,
);

// --- What the client now does: one at a time, each with the fresh version. ---
const fresh = await call(`/api/entries/${id}`);
const v2 = fresh.body?.data?.version;
const first = await call(`/api/entries/${id}`, {
  method: "PATCH",
  body: JSON.stringify({ content: "queued first", expectedVersion: v2 }),
});
const second = await call(`/api/entries/${id}`, {
  method: "PATCH",
  body: JSON.stringify({ content: "queued second", expectedVersion: first.body?.data?.version }),
});
check(
  "serialised saves both succeed",
  first.status === 200 && second.status === 200,
  `got ${first.status} then ${second.status}`,
);

const finalRead = await call(`/api/entries/${id}`);
check(
  "the last thing typed is what is stored",
  finalRead.body?.data?.content === "queued second",
  JSON.stringify(finalRead.body?.data?.content),
);

// Soft-delete the probe so the diary is not left with a test row; the marker
// also makes it removable by cleanup-verification.mjs if this fails.
const removed = await call(`/api/entries/${id}`, { method: "DELETE" });
console.log(`\n  probe removed: HTTP ${removed.status}`);

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
