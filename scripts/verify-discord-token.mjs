/**
 * Verifies a Discord bot token WITHOUT ever printing it.
 *
 * Reads DISCORD_BOT_TOKEN from the Hermes env file (or the environment), calls
 * GET /users/@me to prove the token is live, and reports only non-secret facts
 * about the bot. Read-only: it posts nothing.
 *
 *   node scripts/verify-discord-token.mjs [--send] [--channel <id>]
 *
 * --send additionally posts one harmless test line to --channel (or
 * DISCORD_HOME_CHANNEL if omitted), proving outbound delivery end to end.
 */
import fs from "node:fs";
import path from "node:path";

const home = process.env.USERPROFILE ?? process.env.HOME;
const hermesEnv = path.join(home, "AppData", "Local", "hermes", ".env");

const args = process.argv.slice(2);
const shouldSend = args.includes("--send");
const channelArg = args.includes("--channel") ? args[args.indexOf("--channel") + 1] : null;

function readEnvValue(file, key) {
  if (!fs.existsSync(file)) return "";
  const m = new RegExp(`^\\s*${key}\\s*[:=]\\s*(.*)$`, "m").exec(fs.readFileSync(file, "utf8"));
  if (!m) return "";
  return m[1].trim().replace(/^["']|["']$/g, "");
}

const token =
  process.env.DISCORD_BOT_TOKEN ||
  readEnvValue(path.join(process.cwd(), ".env"), "DISCORD_BOT_TOKEN") ||
  readEnvValue(hermesEnv, "DISCORD_BOT_TOKEN");

if (!token) {
  console.log("No DISCORD_BOT_TOKEN found in the project .env or the Hermes .env.");
  process.exit(1);
}

console.log(`Token source: ${token.length} chars, starts ${token.slice(0, 6)}… (value never printed)`);

const auth = { authorization: `Bot ${token}` };

// ── 1. identity ───────────────────────────────────────────────────────────────
const meRes = await fetch("https://discord.com/api/v10/users/@me", { headers: auth });
if (!meRes.ok) {
  console.log(`\nGET /users/@me → ${meRes.status} (token rejected or revoked)`);
  process.exit(1);
}
const me = await meRes.json();
console.log(`\nToken is LIVE.`);
console.log(`  bot username : ${me.username}`);
console.log(`  bot id       : ${me.id}`);
console.log(`  bot flag     : ${me.bot === true}`);

// ── 2. which channels can it see ──────────────────────────────────────────────
const guildsRes = await fetch("https://discord.com/api/v10/users/@me/guilds", { headers: auth });
const guilds = guildsRes.ok ? await guildsRes.json() : [];
console.log(`  guilds       : ${guilds.length}${guilds.length ? ` (${guilds.map((g) => g.name).join(", ")})` : ""}`);

const homeChannel = channelArg || readEnvValue(hermesEnv, "DISCORD_HOME_CHANNEL");
if (homeChannel) {
  const chRes = await fetch(`https://discord.com/api/v10/channels/${homeChannel}`, { headers: auth });
  if (chRes.ok) {
    const ch = await chRes.json();
    console.log(`  home channel : #${ch.name} (${ch.id}) in guild ${ch.guild_id}`);
  } else {
    console.log(`  home channel : ${homeChannel} → ${chRes.status} (not visible to this bot)`);
  }
}

// ── 3. optional outbound proof ────────────────────────────────────────────────
if (shouldSend) {
  if (!homeChannel) {
    console.log("\n--send given but no channel resolved. Pass --channel <id>.");
    process.exit(1);
  }
  const sendRes = await fetch(`https://discord.com/api/v10/channels/${homeChannel}/messages`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({
      content:
        "🧪 **Personal Diary OS** — delivery test. If you can read this, the diary can post to Discord.",
    }),
  });
  if (sendRes.ok) {
    const msg = await sendRes.json();
    console.log(`\nOutbound delivery WORKS — message id ${msg.id} in channel ${homeChannel}.`);
  } else {
    console.log(`\nOutbound delivery FAILED → ${sendRes.status} ${sendRes.statusText}`);
  }
} else {
  console.log("\n(read-only; pass --send to post a one-off delivery test)");
}
