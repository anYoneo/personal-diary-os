/**
 * Keeps the public tunnel warm.
 *
 * Measured on this host (dalang.io free subdomain, Cloudflare → VM port 80):
 *
 *   request 5 s after the previous one  → 0.14 s
 *   request 10 s after the previous one → 6.85 s
 *   request 30 s after the previous one → 6.83 s
 *   curl http://localhost/login         → 0.016 s, always
 *
 * So the app is not slow — it answers in 16 ms — but the path between
 * Cloudflare and this VM is torn down after roughly ten seconds of quiet, and
 * re-establishing it costs about seven. Every "first click after reading a
 * page" pays that, which is exactly what makes the site feel slow.
 *
 * dalang.io exposes no keep-alive or idle-timeout setting, so the instance
 * keeps the path warm itself: one cheap request to a public page every few
 * seconds. /login is chosen deliberately — it is static from the server's point
 * of view, needs no session, and is in the proxy's public allowlist.
 *
 * Why a loop and not cron: cron's granularity is a minute, which is ~6x longer
 * than the timeout being defended against.
 *
 * Set APP_URL (the public URL). With no URL the script exits instead of
 * hammering localhost for nothing.
 */
const raw = (process.env.APP_URL ?? "").trim().replace(/\/+$/, "");
const url = process.env.KEEPALIVE_URL?.trim() || (raw ? `${raw}/login` : "");

if (!url) {
  console.log("[keepalive] APP_URL is not set — nothing to keep warm, exiting.");
  process.exit(0);
}

/** Comfortably inside the observed timeout (warm at 5 s, dead at 10 s). */
const INTERVAL_MS = Number(process.env.KEEPALIVE_INTERVAL_MS ?? 5000);
const TIMEOUT_MS = Number(process.env.KEEPALIVE_TIMEOUT_MS ?? 10_000);

// Plain JavaScript (.mjs) — no type annotations here.
let lastState = null;
let failures = 0;

async function beat() {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      // A cold path shows up as a ~7 s round trip; anything under a second means
      // the tunnel was already warm.
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "manual",
      headers: { "user-agent": "diary-keepalive/1.0" },
    });
    await response.arrayBuffer();
    const ms = Date.now() - started;
    const cold = ms > 2000;

    if (cold) {
      failures += 1;
      console.log(`[keepalive] ${new Date().toISOString()} cold again: ${ms} ms (${response.status})`);
    } else if (lastState !== "up") {
      console.log(`[keepalive] ${new Date().toISOString()} tunnel warm (${ms} ms, ${response.status})`);
    }
    lastState = "up";
  } catch (error) {
    const ms = Date.now() - started;
    failures += 1;
    const reason = error instanceof Error ? error.message : String(error);
    // Log the state change, not every blip — a flaky tunnel would otherwise
    // bury the log in 17 000 identical lines a day.
    if (lastState !== "down") {
      console.log(`[keepalive] ${new Date().toISOString()} tunnel unreachable: ${reason} (${ms} ms)`);
    }
    lastState = "down";
  }
}

console.log(`[keepalive] warming ${url} every ${INTERVAL_MS} ms`);

// Self-scheduling rather than setInterval: a cold beat takes ~7 s, which is longer
// than the interval, so a fixed timer would stack overlapping requests exactly
// when the tunnel is at its worst.
async function loop() {
  await beat();
  setTimeout(() => void loop(), INTERVAL_MS);
}

await loop();

// A summary every hour, so a long-running process still reports its health.
setInterval(() => {
  if (failures > 0) console.log(`[keepalive] ${failures} cold/failed beat(s) in the last hour`);
  failures = 0;
}, 3_600_000);
