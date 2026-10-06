#!/usr/bin/env node
/**
 * End-to-end proof of multi-user isolation against a running server.
 *
 * Unit tests prove the service layer filters by userId. This proves the whole
 * path over real HTTP: a second account is registered with an invite code, then
 * tries to read and mutate the owner's diary through the public API and must be
 * refused. It also asserts the owner cannot see the new user's writing.
 *
 * The owner password is read from .env and used but never printed.
 *
 *   npm run verify:multiuser                 # against http://localhost:3111
 *   BASE_URL=https://you.example npm run verify:multiuser
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";

// Load .env by hand so this needs no dotenv install.
function envFromFile(key) {
  const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[1] === key) return m[2].replace(/^"|"$/g, "");
  }
  return "";
}

const OWNER_EMAIL = envFromFile("ADMIN_EMAIL");
const OWNER_PASSWORD = envFromFile("ADMIN_PASSWORD");

if (!OWNER_EMAIL || !OWNER_PASSWORD) {
  console.error("ADMIN_EMAIL / ADMIN_PASSWORD missing from .env — cannot run.");
  process.exit(1);
}

const prisma = new PrismaClient();
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newCode() {
  let s = "";
  for (const b of Buffer.from(crypto.getRandomValues(new Uint8Array(8)))) {
    s += ALPHABET[b % ALPHABET.length];
  }
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? ` — ${detail}` : ""}`);
}

/** Minimal cookie jar — fetch does not persist cookies for us. */
function jar() {
  const store = new Map();
  return {
    header: () =>
      [...store.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
    absorb(res) {
      const raw = res.headers.getSetCookie?.() ?? [];
      for (const cookie of raw) {
        const [pair] = cookie.split(";");
        const idx = pair.indexOf("=");
        if (idx > 0) store.set(pair.slice(0, idx), pair.slice(idx + 1));
      }
    },
  };
}

async function req(path, { method = "GET", body, cookies } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookies ? { cookie: cookies.header() } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  if (cookies) cookies.absorb(res);
  const text = await res.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text.slice(0, 120) };
  }
  return { status: res.status, payload };
}

const stamp = Date.now();
const NEW_EMAIL = `e2e-${stamp}@example.com`;
const NEW_PASSWORD = "e2e-throwaway-passphrase-9f2";

async function main() {
  console.log(`\nMulti-user isolation check against ${BASE}\n`);

  // 0. Reachable and expecting auth.
  const health = await req("/api/entries");
  check("unauthenticated /api/entries is refused", health.status === 401, `got ${health.status}`);

  // 1. Invite code, as the operator would mint it.
  const code = newCode();
  await prisma.signupCode.create({ data: { code, maxUses: 1, usedCount: 0, note: "e2e" } });

  // 2. Register a second account using that code.
  const regJar = jar();
  const reg = await req("/api/auth/register", {
    method: "POST",
    body: { email: NEW_EMAIL, password: NEW_PASSWORD, inviteCode: code, name: "E2E" },
    cookies: regJar,
  });
  check("registration with a valid invite code succeeds", reg.status === 201, JSON.stringify(reg.payload));

  // 3. The single-use code cannot be reused.
  const reuse = await req("/api/auth/register", {
    method: "POST",
    body: { email: `other-${stamp}@example.com`, password: NEW_PASSWORD, inviteCode: code },
  });
  check("the same invite code cannot be reused", reuse.status >= 400, `got ${reuse.status}`);

  // 3b. A bogus code is refused too.
  const bogus = await req("/api/auth/register", {
    method: "POST",
    body: { email: `bogus-${stamp}@example.com`, password: NEW_PASSWORD, inviteCode: "ZZZZ-ZZZZ" },
  });
  check("a fabricated invite code is refused", bogus.status >= 400, `got ${bogus.status}`);

  // 4. Owner signs in and writes something private.
  const ownerJar = jar();
  const login = await req("/api/auth/login", {
    method: "POST",
    body: { email: OWNER_EMAIL, password: OWNER_PASSWORD },
    cookies: ownerJar,
  });
  check("owner can sign in", login.status === 200, JSON.stringify(login.payload));

  const secret = `PRIVATE-OWNER-NOTE-${stamp}`;
  const created = await req("/api/entries", {
    method: "POST",
    body: { content: secret },
    cookies: ownerJar,
  });
  const ownerEntryId = created.payload?.data?.id ?? created.payload?.id;
  check("owner can create an entry", !!ownerEntryId, JSON.stringify(created.payload).slice(0, 200));

  // 5. THE point: the new account must not see it.
  const intruderList = await req("/api/entries?limit=50", { cookies: regJar });
  const listBody = JSON.stringify(intruderList.payload);
  check("intruder's entry list does not contain the owner's note", !listBody.includes(secret));

  const intruderGet = await req(`/api/entries/${ownerEntryId}`, { cookies: regJar });
  check("intruder cannot fetch the owner's entry by id", intruderGet.status >= 400, `got ${intruderGet.status}`);

  const intruderPatch = await req(`/api/entries/${ownerEntryId}`, {
    method: "PATCH",
    body: { content: "hijacked" },
    cookies: regJar,
  });
  check("intruder cannot edit the owner's entry", intruderPatch.status >= 400, `got ${intruderPatch.status}`);

  const intruderDelete = await req(`/api/entries/${ownerEntryId}`, { method: "DELETE", cookies: regJar });
  check("intruder cannot delete the owner's entry", intruderDelete.status >= 400, `got ${intruderDelete.status}`);

  // The response echoes the query back, so compare the *hits*, not the payload:
  // a substring test on the whole body would pass/fail on the echo, not the data.
  const intruderSearch = await req(`/api/search?q=${encodeURIComponent(secret)}`, { cookies: regJar });
  const intruderHits = intruderSearch.payload?.data?.hits ?? [];
  check("intruder's search returns zero hits for the owner's note",
    intruderSearch.status === 200 && intruderHits.length === 0,
    `status ${intruderSearch.status}, ${intruderHits.length} hits`);

  // 6. The owner's entry is genuinely still there and unmodified.
  const ownerGet = await req(`/api/entries/${ownerEntryId}`, { cookies: ownerJar });
  const ownerBody = JSON.stringify(ownerGet.payload);
  check("the owner's entry still exists and is unmodified",
    ownerGet.status === 200 && ownerBody.includes(secret) && !ownerBody.includes("hijacked"),
    `status ${ownerGet.status}`);

  // 7. And the reverse: the owner cannot see the intruder's writing.
  const intruderSecret = `PRIVATE-NEWUSER-NOTE-${stamp}`;
  await req("/api/entries", { method: "POST", body: { content: intruderSecret }, cookies: regJar });

  const ownerList = await req("/api/entries?limit=50", { cookies: ownerJar });
  check("owner sees only their own entries", !JSON.stringify(ownerList.payload).includes(intruderSecret));

  const ownerSearch = await req(`/api/search?q=${encodeURIComponent(intruderSecret)}`, { cookies: ownerJar });
  const ownerHits = ownerSearch.payload?.data?.hits ?? [];
  check("owner's search returns zero hits for the new user's note",
    ownerSearch.status === 200 && ownerHits.length === 0,
    `status ${ownerSearch.status}, ${ownerHits.length} hits`);

  // 8. A non-operator cannot mint invite codes.
  const intruderInvites = await req("/api/invites", { cookies: regJar });
  check("a non-operator cannot list invite codes", intruderInvites.status >= 400, `got ${intruderInvites.status}`);
  const intruderMint = await req("/api/invites", { method: "POST", body: {}, cookies: regJar });
  check("a non-operator cannot mint invite codes", intruderMint.status >= 400, `got ${intruderMint.status}`);

  // 9. The operator can.
  const mint = await req("/api/invites", { method: "POST", body: { note: "e2e" }, cookies: ownerJar });
  check("the operator can mint an invite code", mint.status === 201, `got ${mint.status}`);
  const mintedCode = mint.payload?.data?.code;

  const cleanedIntruder = await prisma.user.deleteMany({ where: { email: NEW_EMAIL } });
  check("cleanup removed the throwaway account", cleanedIntruder.count === 1);

  if (mintedCode) await prisma.signupCode.deleteMany({ where: { code: mintedCode } });
  await prisma.signupCode.deleteMany({ where: { code } });

  // Leave no trace of this run in the diary.
  const cleanedEntries = await prisma.entry.deleteMany({
    where: { content: { contains: `-${stamp}` } },
  });
  check("cleanup removed the test entries", cleanedEntries.count >= 1, `removed ${cleanedEntries.count}`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log("\nFAILED:");
    for (const f of failed) console.log(`  - ${f.name} (${f.detail})`);
  }
  console.log();
  return failed.length === 0;
}

main()
  .then((ok) => {
    process.exitCode = ok ? 0 : 1;
  })
  .catch((e) => {
    console.error("\nCheck aborted:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
