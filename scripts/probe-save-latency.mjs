/**
 * Times a sequence of real saves over public HTTPS, so "is saving fast now?" is
 * answered with numbers rather than a feeling.
 *
 *   PROBE_BASE_URL=https://<app> node scripts/probe-save-latency.mjs
 *
 * Reads credentials from the repo's .env and never prints them. The scratch
 * entry is soft-deleted and tagged "save-race probe" so cleanup-verification.mjs
 * also removes it if this fails midway.
 */
import { readFileSync } from "node:fs";

const raw = readFileSync(new URL("../.env", import.meta.url), "utf8");
const envValue = (key) => {
  const line = raw.split(/\r?\n/).find((l) => l.trim().startsWith(`${key}=`));
  return line ? line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "") : "";
};

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
  const response = await fetch(`${base}${path}`, {
    ...options,
    signal: AbortSignal.timeout(60000),
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
}

const timings = [];
const record = (label, r) => {
  timings.push({ label, ms: r.ms, status: r.status });
  console.log(`  ${String(r.status).padEnd(3)} ${String(r.ms + "ms").padStart(9)}  ${label}`);
};

console.log(`target ${base}\n`);

record("GET /login", await call("/login"));

const login = await call("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ email, password }),
});
record("POST /api/auth/login", login);
if (login.status !== 200) process.exit(1);

const created = await call("/api/entries", {
  method: "POST",
  body: JSON.stringify({ content: "save-race probe — safe to delete", source: "web" }),
});
record("POST /api/entries (create)", created);
const id = created.body?.data?.id;
if (!id) {
  console.log("no entry id; aborting");
  process.exit(1);
}

// Eight sequential saves, each with the version the previous one returned —
// exactly what the editor's queue now does.
let version = created.body?.data?.version;
for (let i = 1; i <= 8; i++) {
  const patch = await call(`/api/entries/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ content: `save number ${i}`, expectedVersion: version }),
  });
  record(`PATCH save #${i}`, patch);
  if (patch.status !== 200) break;
  version = patch.body?.data?.version;
}

record("GET the entry back", await call(`/api/entries/${id}`));

const removed = await call(`/api/entries/${id}`, { method: "DELETE" });
console.log(`\n  probe removed: HTTP ${removed.status}`);

const saves = timings.filter((t) => t.label.startsWith("PATCH"));
const sorted = [...saves].map((s) => s.ms).sort((a, b) => a - b);
const median = sorted[Math.floor(sorted.length / 2)];
console.log(`\nsaves: n=${saves.length} min=${sorted[0]}ms median=${median}ms max=${sorted[sorted.length - 1]}ms`);
// A save the user is waiting on should feel instant; 1s is already generous.
console.log(`every save under 1000ms: ${sorted[sorted.length - 1] < 1000 ? "yes" : "NO"}`);
