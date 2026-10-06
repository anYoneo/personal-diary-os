/**
 * Wires the diary to Discord using an EXISTING bot token, without ever printing
 * the token or asking the user to paste it into chat.
 *
 *   node scripts/link-discord.mjs                # reuse the Hermes bot token
 *   node scripts/link-discord.mjs --channel <id> # notify a specific channel
 *   node scripts/link-discord.mjs --token-env     # read DISCORD_BOT_TOKEN from env
 *
 * What it does:
 *   1. resolves a token (env var, project .env, or the Hermes .env)
 *   2. confirms it is live and resolves the bot's application id
 *   3. opens the owner's DM channel to use as the notification target
 *   4. writes DISCORD_BOT_TOKEN / APPLICATION_ID / NOTIFY_CHANNEL_ID into the
 *      project .env, preserving every other line
 */
import fs from "node:fs";
import path from "node:path";

const home = process.env.USERPROFILE ?? process.env.HOME;
const projectEnv = path.join(process.cwd(), ".env");
const hermesEnv = path.join(home, "AppData", "Local", "hermes", ".env");
const OWNER_ID = "000000000000000000";

const args = process.argv.slice(2);
const channelId = args.includes("--channel") ? args[args.indexOf("--channel") + 1] : null;

const readEnvValue = (file, key) => {
  if (!fs.existsSync(file)) return "";
  const m = new RegExp(`^\\s*${key}\\s*[:=]\\s*(.*)$`, "m").exec(fs.readFileSync(file, "utf8"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
};

const token =
  process.env.DISCORD_BOT_TOKEN ||
  readEnvValue(projectEnv, "DISCORD_BOT_TOKEN") ||
  readEnvValue(hermesEnv, "DISCORD_BOT_TOKEN");

if (!token) {
  console.log("No bot token found. Set DISCORD_BOT_TOKEN in the environment or the project .env.");
  process.exit(1);
}

const auth = { authorization: `Bot ${token}`, "content-type": "application/json" };

const meRes = await fetch("https://discord.com/api/v10/users/@me", { headers: auth });
if (!meRes.ok) {
  console.log(`Token rejected → ${meRes.status}. Cannot link.`);
  process.exit(1);
}
const me = await meRes.json();
console.log(`Bot: ${me.username} (id ${me.id})`);

// For a bot, the application id is the bot's user id.
const applicationId = me.id;

let target = channelId;
if (!target) {
  const dmRes = await fetch("https://discord.com/api/v10/users/@me/channels", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ recipient_id: OWNER_ID }),
  });
  if (!dmRes.ok) {
    console.log(`Could not open a DM channel → ${dmRes.status}`);
    process.exit(1);
  }
  const dm = await dmRes.json();
  target = dm.id;
  console.log(`Notification target: DM with ${OWNER_ID} (channel ${target})`);
} else {
  console.log(`Notification target: channel ${target}`);
}

// ── write .env, preserving unrelated lines ───────────────────────────────────
const original = fs.existsSync(projectEnv) ? fs.readFileSync(projectEnv, "utf8") : "";
const lines = original.split(/\r?\n/);

const updates = new Map([
  ["DISCORD_BOT_TOKEN", token],
  ["DISCORD_APPLICATION_ID", applicationId],
  ["DISCORD_NOTIFY_CHANNEL_ID", target],
]);

const seen = new Set();
const next = lines.map((line) => {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*=/.exec(line);
  if (!m || !updates.has(m[1])) return line;
  seen.add(m[1]);
  // Token is written raw; the other two are quoted like the rest of the file.
  const key = m[1];
  return key === "DISCORD_BOT_TOKEN" ? `${key}=${updates.get(key)}` : `${key}="${updates.get(key)}"`;
});

for (const [key, value] of updates) {
  if (!seen.has(key)) {
    next.push(key === "DISCORD_BOT_TOKEN" ? `${key}=${value}` : `${key}="${value}"`);
  }
}

fs.writeFileSync(projectEnv, next.join("\n"), { mode: 0o600 });
console.log(`\nWrote ${updates.size} Discord values into .env (token value never displayed).`);
console.log("Next: `npm run worker` (or `npx tsx src/worker/index.ts --once`) to deliver queued notifications.");
