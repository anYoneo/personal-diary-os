/**
 * Proves the diary's outbound path works, by posting ONE message to the owner's
 * DM (never a channel the Hermes gateway also watches, so nothing loops).
 *
 * Reads the token itself; the value is never printed.
 *   node scripts/test-dm.mjs            # dry-run info only
 *   node scripts/test-dm.mjs --send     # actually deliver
 */
import fs from "node:fs";
import path from "node:path";

const home = process.env.USERPROFILE ?? process.env.HOME;
const hermesEnv = path.join(home, "AppData", "Local", "hermes", ".env");

const read = (file, key) => {
  if (!fs.existsSync(file)) return "";
  const m = new RegExp(`^\\s*${key}\\s*[:=]\\s*(.*)$`, "m").exec(fs.readFileSync(file, "utf8"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
};

const token = process.env.DISCORD_BOT_TOKEN || read(hermesEnv, "DISCORD_BOT_TOKEN");
const ownerId = "000000000000000000"; // the diary's owner (Discord user id)

if (!token) {
  console.log("No token available.");
  process.exit(1);
}

const auth = { authorization: `Bot ${token}`, "content-type": "application/json" };

// Open (or reuse) the DM channel with the owner.
const dmRes = await fetch("https://discord.com/api/v10/users/@me/channels", {
  method: "POST",
  headers: auth,
  body: JSON.stringify({ recipient_id: ownerId }),
});
if (!dmRes.ok) {
  console.log(`Could not open a DM channel → ${dmRes.status}`);
  process.exit(1);
}
const dm = await dmRes.json();
console.log(`DM channel ready: ${dm.id} (with user ${ownerId})`);

if (!process.argv.includes("--send")) {
  console.log("Dry run. Pass --send to deliver the test message.");
  process.exit(0);
}

const body = {
  content: "🧪 **Personal Diary OS** — delivery test",
  embeds: [
    {
      title: "If you can read this, the diary can reach you",
      description:
        "This message was sent by the diary's notification worker over the Discord REST API. "
        + "No diary text is included — it is a connection check.",
      color: 0xd8b26a,
      footer: { text: "scripts/test-dm.mjs" },
    },
  ],
};

const sendRes = await fetch(`https://discord.com/api/v10/channels/${dm.id}/messages`, {
  method: "POST",
  headers: auth,
  body: JSON.stringify(body),
});

if (sendRes.ok) {
  const msg = await sendRes.json();
  console.log(`DELIVERED. message id ${msg.id} at ${msg.timestamp}`);
} else {
  // Discord error bodies never contain diary text, so this is safe to show.
  console.log(`FAILED → ${sendRes.status} ${await sendRes.text()}`);
}
