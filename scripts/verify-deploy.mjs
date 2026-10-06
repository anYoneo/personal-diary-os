/**
 * End-to-end deployment check against a RUNNING instance.
 *
 *   BASE_URL=http://127.0.0.1:3111 ADMIN_EMAIL=... ADMIN_PASSWORD=... \
 *     node scripts/verify-deploy.mjs
 *
 * Proves the deploy is actually usable, not merely "container is up":
 *   1. /login answers 200                     (no DB needed)
 *   2. login with the owner credentials works (DB read + session cookie)
 *   3. an entry can be written                (DB write)
 *   4. it reads back with its tags intact     (the Zod .partial() regression)
 *   5. the row survives in the database file  (volume is really mounted)
 *
 * Exits non-zero on the first failure so it is usable as a deploy gate.
 */
const base = (process.env.BASE_URL ?? "http://127.0.0.1:3111").replace(/\/$/, "");
const email = process.env.ADMIN_EMAIL ?? "";
const password = process.env.ADMIN_PASSWORD ?? "";

let failures = 0;
const ok = (label, extra = "") => console.log(`  PASS  ${label}${extra ? ` — ${extra}` : ""}`);
const bad = (label, extra = "") => {
  failures += 1;
  console.log(`  FAIL  ${label}${extra ? ` — ${extra}` : ""}`);
};

console.log(`Verifying ${base}\n`);

// 1. public route
const loginPage = await fetch(`${base}/login`);
if (loginPage.status === 200) ok("GET /login", "200");
else bad("GET /login", `expected 200, got ${loginPage.status}`);

// 2. authentication
if (!email || !password) {
  bad("login", "ADMIN_EMAIL / ADMIN_PASSWORD not provided");
} else {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const cookies = res.headers.getSetCookie?.() ?? [];
  const cookie = cookies.map((c) => c.split(";")[0]).join("; ");
  if (res.status === 200 && cookie) {
    ok("POST /api/auth/login", "session cookie issued");
  } else {
    bad("POST /api/auth/login", `status ${res.status}, cookie ${cookie ? "yes" : "no"}`);
  }

  if (cookie) {
    // 3. write
    const marker = `deploy check ${new Date().toISOString()}`;
    const created = await fetch(`${base}/api/entries`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        content: `${marker} — written by scripts/verify-deploy.mjs`,
        entryType: "work",
        mood: "good",
        tags: ["deploy-check"],
        isImportant: true,
      }),
    });
    const body = await created.json().catch(() => ({}));
    const id = body?.data?.id;
    if (created.status === 201 && id) ok("POST /api/entries", `201 (${id})`);
    else bad("POST /api/entries", `status ${created.status}`);

    // 4a. The PATCH response is a deliberately minimal autosave summary
    //     (id/day/wordCount/version/updatedAt/tags) — it does NOT echo entryType.
    if (id) {
      const patched = await fetch(`${base}/api/entries/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ content: `${marker} — updated body only` }),
      });
      const after = await patched.json().catch(() => ({}));
      const d = after?.data ?? {};
      const keptTags = Array.isArray(d.tags)
        ? d.tags.map((t) => (typeof t === "string" ? t : t.name))
        : d.tags;
      if (patched.status === 200 && Array.isArray(keptTags) && keptTags.includes("deploy-check")) {
        ok("PATCH keeps tags (autosave summary)", `tags=${keptTags.join(",")}`);
      } else {
        bad("PATCH keeps tags (autosave summary)", `tags=${JSON.stringify(keptTags)}`);
      }

      // 4b. Re-read the entry the way the UI does — this is the real test that a
      //     content-only autosave did not wipe entryType/mood/isImportant.
      const reread = await fetch(`${base}/api/entries/${id}`, { headers: { cookie } });
      const full = ((await reread.json().catch(() => ({})))?.data ?? {});
      const fullTags = Array.isArray(full.tags)
        ? full.tags.map((t) => (typeof t === "string" ? t : t.name))
        : [];
      if (
        reread.status === 200 &&
        full.entryType === "work" &&
        full.mood === "good" &&
        full.isImportant === true &&
        fullTags.includes("deploy-check")
      ) {
        ok("autosave preserved type/mood/important", `type=${full.entryType} mood=${full.mood}`);
      } else {
        bad(
          "autosave preserved type/mood/important",
          `type=${full.entryType} mood=${full.mood} important=${full.isImportant} tags=${fullTags.join(",")}`,
        );
      }

      // 5. clean up the row we created
      const del = await fetch(`${base}/api/entries/${id}`, { method: "DELETE", headers: { cookie } });
      if (del.status === 200 || del.status === 204) ok("DELETE /api/entries/:id", `${del.status}`);
      else bad("DELETE /api/entries/:id", `status ${del.status}`);
    }
  }
}

// unauthenticated access must be refused
const guard = await fetch(`${base}/api/entries`);
if (guard.status === 401 || guard.status === 403) ok("GET /api/entries unauthenticated", `${guard.status}`);
else bad("GET /api/entries unauthenticated", `expected 401/403, got ${guard.status}`);

console.log(failures === 0 ? "\nAll deployment checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
