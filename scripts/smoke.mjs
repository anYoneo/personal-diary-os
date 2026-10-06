/**
 * End-to-end smoke test against a RUNNING dev server. Exercises the real HTTP
 * surface the browser uses: login → create → autosave → edit → search →
 * memories → analytics → trash restore/purge. Prints PASS/FAIL per step.
 *
 *   node scripts/smoke.mjs [baseUrl]
 *
 * The password is read from .env and never printed.
 */
import fs from "node:fs";
import path from "node:path";

const base = process.argv[2] ?? "http://localhost:3111";

function envValue(key) {
  const text = fs.readFileSync(path.join(process.cwd(), ".env"), "utf8");
  const match = new RegExp(`^${key}="?([^"\\n]*)"?`, "m").exec(text);
  if (!match) throw new Error(`${key} missing from .env`);
  return match[1];
}

let cookie = "";
const results = [];

async function step(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (error) {
    results.push({ name, ok: false, detail: error.message });
    console.log(`FAIL  ${name} — ${error.message}`);
  }
}

async function call(method, url, body, { expect } = {}) {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: {
      "content-type": "application/json",
      cookie,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const ok = expect ? expect.includes(res.status) : res.status >= 200 && res.status < 300;
  if (!ok) {
    const text = await res.text();
    throw new Error(`${method} ${url} → ${res.status} ${text.slice(0, 300)}`);
  }
  const ct = res.headers.get("content-type") ?? "";
  return ct.includes("json") ? res.json() : res.text();
}

// ── auth ─────────────────────────────────────────────────────────────────────
await step("unauthenticated API access is refused", async () => {
  const res = await fetch(`${base}/api/entries`, { redirect: "manual" });
  if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
  return "401";
});

await step("bad credentials are refused", async () => {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "nope@example.com", password: "wrong-password" }),
  });
  if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
  return "401";
});

await step("login sets a session cookie", async () => {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: envValue("ADMIN_EMAIL"),
      password: envValue("ADMIN_PASSWORD"),
    }),
  });
  if (!res.ok) throw new Error(`login → ${res.status} ${await res.text()}`);
  const raw = res.headers.getSetCookie?.() ?? [];
  cookie = raw.map((c) => c.split(";")[0]).join("; ");
  if (!cookie.includes("diary_session")) throw new Error("no session cookie returned");
  return "cookie issued";
});

// ── entries ──────────────────────────────────────────────────────────────────
let entryId = "";
await step("create entry with markdown, tags, mood", async () => {
  const data = await call("POST", "/api/entries", {
    content:
      "# Smoke test\n\nToday I finally started the credit limit project.\n\n- [ ] migrate table\n- [x] read the spec\n\n> quote\n\n```sql\nselect 1;\n```\n\n#work #oracle",
    entryType: "work",
    mood: "motivated",
    isImportant: true,
    tags: ["work", "oracle"],
  });
  const e = data.data;
  entryId = e.id;
  if (!e.id) throw new Error(`no id in response: ${JSON.stringify(data)}`);
  if (!e.wordCount || e.wordCount < 10) throw new Error(`wordCount wrong: ${e.wordCount}`);
  const local = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  if (e.day !== local) throw new Error(`day bucket wrong: ${e.day} vs ${local}`);
  return `id=${entryId} words=${e.wordCount} day=${e.day}`;
});

await step("tags were applied without duplicates", async () => {
  const data = await call("GET", `/api/entries/${entryId}`);
  const slugs = data.data.tags;
  if (!Array.isArray(slugs) || slugs.length === 0) throw new Error(`no tags: ${JSON.stringify(data.data.tags)}`);
  if (new Set(slugs).size !== slugs.length) throw new Error(`duplicate tags: ${slugs}`);
  if (!slugs.includes("work")) throw new Error(`tags missing work: ${slugs}`);
  return slugs.join(",");
});

await step("autosave (PATCH) updates content and recomputes word count", async () => {
  const data = await call("PATCH", `/api/entries/${entryId}`, {
    content: "# Smoke test\n\nToday I finally started the credit limit project. It shipped.",
    tags: ["work", "oracle", "shipping"],
  });
  const e = data.data;
  if (!e.wordCount) throw new Error("wordCount not recomputed");
  if (e.version < 2) throw new Error(`version did not advance: ${e.version}`);
  if (e.tags.length !== 3) throw new Error(`tags not applied: ${e.tags}`);
  return `words=${e.wordCount} version=${e.version} tags=${e.tags.join(",")}`;
});

// Regression guard: a lone content edit must never reset the type or drop tags.
await step("content-only autosave preserves type and tags", async () => {
  const before = (await call("GET", `/api/entries/${entryId}`)).data;
  await call("PATCH", `/api/entries/${entryId}`, { content: before.content + "\n\nOne more line." });
  const after = (await call("GET", `/api/entries/${entryId}`)).data;
  if (after.entryType !== before.entryType) {
    throw new Error(`entryType was reset: ${before.entryType} → ${after.entryType}`);
  }
  if (after.mood !== before.mood) {
    throw new Error(`mood was reset: ${before.mood} → ${after.mood}`);
  }
  if (after.tags.length !== before.tags.length) {
    throw new Error(`tags were wiped: [${before.tags}] → [${after.tags}]`);
  }
  if (after.isImportant !== before.isImportant) throw new Error("isImportant was reset");
  return `type=${after.entryType} mood=${after.mood} tags=${after.tags.join(",")} preserved`;
});

await step("concurrent edits are rejected by optimistic version check", async () => {
  const res = await fetch(`${base}/api/entries/${entryId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ content: "stale write", expectedVersion: 1 }),
  });
  if (res.status !== 409) throw new Error(`expected 409 conflict, got ${res.status}`);
  const body = await res.json();
  return `${res.status} ${body.error.code}`;
});

await step("validation rejects an empty entry", async () => {
  const res = await fetch(`${base}/api/entries`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ content: "   " }),
  });
  if (res.status !== 400 && res.status !== 422) throw new Error(`expected 4xx, got ${res.status}`);
  const body = await res.json();
  if (!body.error?.message) throw new Error("no error message returned");
  return `${res.status} ${body.error.code}`;
});

await step("validation rejects a bogus mood", async () => {
  const res = await fetch(`${base}/api/entries`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ content: "hello there", mood: "ecstatic" }),
  });
  if (res.status !== 400 && res.status !== 422) throw new Error(`expected 4xx, got ${res.status}`);
  return `${res.status}`;
});

await step("unknown entry id returns 404, not a stack trace", async () => {
  const res = await fetch(`${base}/api/entries/does-not-exist`, { headers: { cookie } });
  if (res.status !== 404) throw new Error(`expected 404, got ${res.status}`);
  const body = await res.json();
  if (/prisma|sql|stack/i.test(JSON.stringify(body))) throw new Error("leaked internals");
  return "404 clean";
});

// ── search & memory ──────────────────────────────────────────────────────────
await step("full-text search finds the entry", async () => {
  const data = await call("GET", "/api/search?q=credit%20limit");
  if (data.data.hits.length === 0) throw new Error("no hits");
  const hit = data.data.hits[0];
  if (!/credit limit/i.test(hit.title + hit.excerpt)) throw new Error("bad excerpt");
  return `${data.data.hits.length} hit(s), total=${data.data.total}`;
});

await step("search filters by tag and type", async () => {
  const byTag = await call("GET", "/api/search?tag=oracle&type=work");
  if (byTag.data.hits.length === 0) throw new Error("tag+type filter returned nothing");
  const byBadTag = await call("GET", "/api/search?tag=does-not-exist-xyz");
  if (byBadTag.data.hits.length !== 0) throw new Error("bogus tag matched");
  return `${byTag.data.hits.length} via tag+type`;
});

await step("mention stats report first/last mention", async () => {
  const data = await call("GET", "/api/search?q=credit&mode=mentions");
  const m = data.data.stats;
  if (!m || m.mentions < 1) throw new Error(`no mention stats: ${JSON.stringify(data.data)}`);
  if (!m.firstMention?.day) throw new Error("no first mention day");
  return `${m.mentions} mention(s), first ${m.firstMention.day}`;
});

await step("random memory / on-this-day endpoints work", async () => {
  const random = await call("GET", "/api/memories?mode=random");
  if (!("memory" in random.data)) throw new Error("random shape wrong");
  const otd = await call("GET", "/api/memories?mode=on-this-day");
  if (!("memory" in otd.data)) throw new Error("on-this-day shape wrong");
  const threads = await call("GET", "/api/memories?mode=threads");
  if (!Array.isArray(threads.data.threads)) throw new Error("threads shape wrong");
  const ghosts = await call("GET", "/api/memories?mode=ghosts");
  if (!Array.isArray(ghosts.data.ghosts)) throw new Error("ghosts shape wrong");
  const digest = await call("GET", "/api/memories");
  if (digest.data.mode !== "digest") throw new Error("digest shape wrong");
  return `random=${random.data.memory ? "hit" : "empty(ok)"}, otd=${otd.data.memory ? "hit" : "empty(ok)"}, threads=${threads.data.threads.length}`;
});

// ── analytics, goals, threads, thoughts ──────────────────────────────────────
await step("analytics returns real derived numbers", async () => {
  const data = await call("GET", "/api/analytics");
  const a = data.data;
  if (typeof a.totals?.entries !== "number") throw new Error("no totals");
  if (a.streaks.current < 1) throw new Error("streak should be at least 1 after writing today");
  return `${a.totals.entries} entries, streak ${a.streaks.current}`;
});

await step("goals CRUD", async () => {
  const created = await call("POST", "/api/goals", { title: "Ship the diary", status: "active" });
  const id = created.data.id;
  if (!id) throw new Error(`no id: ${JSON.stringify(created)}`);
  const updated = await call("PATCH", `/api/goals/${id}`, { status: "done" });
  if (updated.data.status !== "done") throw new Error("status not updated");
  await call("DELETE", `/api/goals/${id}`);
  return "create → update → delete";
});

await step("threads CRUD", async () => {
  const name = `Smoke Thread ${Date.now()}`;
  const created = await call("POST", "/api/threads", { name, kind: "topic" });
  const id = created.data.id;
  if (!id) throw new Error(`no id: ${JSON.stringify(created)}`);
  const list = await call("GET", "/api/threads");
  if (!list.data.threads.some((t) => t.id === id)) throw new Error("thread not listed");
  await call("DELETE", `/api/threads/${id}`);
  const after = await call("GET", "/api/threads");
  if (after.data.threads.some((t) => t.id === id)) throw new Error("thread still listed after delete");
  return "create → listed → delete";
});

await step("thoughts CRUD + resolve", async () => {
  const created = await call("POST", "/api/thoughts", { question: "Should I learn TOGAF?" });
  const id = created.data.id;
  if (!id) throw new Error(`no id: ${JSON.stringify(created)}`);
  const resolved = await call("PATCH", "/api/thoughts", {
    id,
    status: "resolved",
    resolvedNote: "Not now.",
  });
  if (resolved.data.status !== "resolved") throw new Error("not resolved");
  await call("DELETE", `/api/thoughts?id=${id}`);
  return "open → resolved → deleted";
});

await step("settings round-trip", async () => {
  const before = await call("GET", "/api/settings");
  const patched = await call("PATCH", "/api/settings", { weeklyReflection: false, quietHoursStart: 22 });
  if (patched.data.settings.weeklyReflection !== false) throw new Error("weeklyReflection not saved");
  if (patched.data.settings.quietHoursStart !== 22) throw new Error("quietHoursStart not saved");
  const reverted = await call("PATCH", "/api/settings", {
    weeklyReflection: before.data.preferences.weeklyReflection,
    quietHoursStart: null,
  });
  if (reverted.data.settings.weeklyReflection !== before.data.preferences.weeklyReflection) {
    throw new Error("revert failed");
  }
  return "patched and reverted";
});

await step("AI reports unavailable instead of faking output", async () => {
  const data = await call("GET", "/api/ai");
  if (data.data.configured !== false) throw new Error(`expected configured:false, got ${JSON.stringify(data.data).slice(0, 120)}`);
  const ran = await call("POST", "/api/ai", { task: "summary", entryId });
  if (ran.data.available !== false) throw new Error("expected available:false with no provider");
  if (!ran.data.reason) throw new Error("no reason given");
  return ran.data.reason.slice(0, 90);
});

await step("AI rejects an unknown task", async () => {
  const res = await fetch(`${base}/api/ai`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ task: "summarise-everything" }),
  });
  if (res.status !== 400 && res.status !== 422) throw new Error(`expected 4xx, got ${res.status}`);
  return `${res.status}`;
});

// ── soft delete ──────────────────────────────────────────────────────────────
await step("delete moves to trash and hides from search", async () => {
  await call("DELETE", `/api/entries/${entryId}`);
  const found = await call("GET", "/api/search?q=credit");
  if (found.data.hits.some((h) => h.id === entryId)) throw new Error("deleted entry still searchable");
  return "hidden";
});

await step("restore brings it back", async () => {
  await call("POST", `/api/entries/${entryId}`);
  const found = await call("GET", "/api/search?q=credit");
  if (!found.data.hits.some((h) => h.id === entryId)) throw new Error("restore did not work");
  return "restored";
});

await step("purge removes it permanently", async () => {
  await call("DELETE", `/api/entries/${entryId}?hard=true`);
  const found = await call("GET", `/api/search?q=credit`);
  if (found.data.hits.some((h) => h.id === entryId)) throw new Error("purge did not work");
  return "purged";
});

// ── pages render ─────────────────────────────────────────────────────────────
for (const page of ["/", "/write", "/timeline", "/search", "/memories", "/threads", "/goals", "/thoughts", "/insights", "/settings", "/trash"]) {
  await step(`page ${page} renders`, async () => {
    const res = await fetch(`${base}${page}`, { headers: { cookie } });
    if (!res.ok) throw new Error(`→ ${res.status}`);
    const html = await res.text();
    if (/Application error|Unhandled Runtime Error/i.test(html)) throw new Error("error boundary rendered");
    return `${res.status} ${html.length}b`;
  });
}

await step("login page is reachable without a session", async () => {
  const res = await fetch(`${base}/login`);
  if (!res.ok) throw new Error(`→ ${res.status}`);
  return `${res.status}`;
});

await step("signed-out users are redirected away from the app", async () => {
  const res = await fetch(`${base}/timeline`, { redirect: "manual" });
  if (res.status !== 307 && res.status !== 302) throw new Error(`expected redirect, got ${res.status}`);
  return `→ ${res.headers.get("location")}`;
});

await step("logout clears the session", async () => {
  await call("POST", "/api/auth/logout");
  const res = await fetch(`${base}/api/entries`, { headers: { cookie } });
  if (res.status !== 401) throw new Error(`expected 401 after logout, got ${res.status}`);
  return "401";
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("\nFailures:");
  for (const f of failed) console.log(` - ${f.name}: ${f.detail}`);
  process.exit(1);
}
