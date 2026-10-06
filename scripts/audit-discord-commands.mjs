/**
 * READ-ONLY audit of the Discord application's slash commands.
 * Shows what is registered globally and per-guild, so we can tell whether a
 * naive global re-registration would wipe commands belonging to another bot
 * that shares this token (the Hermes gateway uses the same one).
 *
 *   node scripts/audit-discord-commands.mjs
 */
import fs from "node:fs";
import path from "node:path";

const home = process.env.USERPROFILE ?? process.env.HOME;
const read = (file, key) => {
  if (!fs.existsSync(file)) return "";
  const m = new RegExp(`^\\s*${key}\\s*[:=]\\s*(.*)$`, "m").exec(fs.readFileSync(file, "utf8"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
};

const env = path.join(process.cwd(), ".env");
const token = process.env.DISCORD_BOT_TOKEN || read(env, "DISCORD_BOT_TOKEN");
const appId = read(env, "DISCORD_APPLICATION_ID");
const auth = { authorization: `Bot ${token}` };

const get = async (url) => {
  const r = await fetch(url, { headers: auth });
  return { status: r.status, body: r.ok ? await r.json() : await r.text() };
};

const global = await get(`https://discord.com/api/v10/applications/${appId}/commands`);
console.log(`global commands → ${global.status}`);
if (Array.isArray(global.body)) {
  console.log(`  count: ${global.body.length}`);
  console.log(`  names: ${global.body.map((c) => c.name).join(", ") || "(none)"}`);
} else {
  console.log(`  ${String(global.body).slice(0, 200)}`);
}

const guilds = await get("https://discord.com/api/v10/users/@me/guilds");
if (Array.isArray(guilds.body)) {
  for (const g of guilds.body) {
    const gcmds = await get(
      `https://discord.com/api/v10/applications/${appId}/guilds/${g.id}/commands`,
    );
    const names = Array.isArray(gcmds.body) ? gcmds.body.map((c) => c.name) : [];
    console.log(`guild ${g.name} (${g.id}) → ${gcmds.status}, ${names.length} commands: ${names.join(", ") || "(none)"}`);
  }
}
