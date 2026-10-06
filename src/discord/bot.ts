import { Client, GatewayIntentBits, Events, Partials, type Message } from "discord.js";
import { config, discordConfigured } from "@/lib/config";
import { prisma } from "@/lib/db";
import { dayKey } from "@/lib/day";
import { createEntry } from "@/lib/services/entries";
import { parseCapture } from "@/lib/services/capture";
import { executeCommand } from "./commands";

/**
 * Gateway bot: slash commands + DM/mention quick capture.
 *
 * ⚠️ SHARED TOKEN: DISCORD_BOT_TOKEN may point at an application that another
 * gateway (e.g. the Hermes agent gateway) is already connected to. A second
 * gateway on the same token means BOTH clients receive every DM, so DM capture
 * is opt-in via DISCORD_CAPTURE_DMS=true. Without it this bot only answers
 * slash commands, which cannot collide with another bot's handlers.
 *
 * Quick capture never listens to every message in a server — only DMs (once
 * enabled) and @mentions inside the configured guild.
 */

if (!discordConfigured()) {
  console.error(
    "Discord bot not configured. Set DISCORD_BOT_TOKEN and DISCORD_APPLICATION_ID in .env, then run `npm run discord:register`.",
  );
  process.exit(1);
}

const captureDms = process.env.DISCORD_CAPTURE_DMS === "true";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

client.once(Events.ClientReady, (ready) => {
  console.log(`Diary bot online as ${ready.user.tag}`);
  console.log(`Notifications channel: ${config.discord.notifyChannelId || "(not set)"}`);
  console.log(
    captureDms
      ? "DM capture: ENABLED — every DM from a linked user becomes a diary entry.\n"
        + "  If another gateway shares this token, both will see those DMs."
      : "DM capture: disabled (DISCORD_CAPTURE_DMS=true to enable). Slash commands still work.",
  );
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    const options: Record<string, string> = {};
    for (const option of interaction.options.data) {
      if (option.value !== undefined) options[option.name] = String(option.value);
    }

    await interaction.deferReply({ ephemeral: false });
    const result = await executeCommand({
      name: interaction.commandName,
      options,
      discordUserId: interaction.user.id,
      username: interaction.user.username,
      guildId: interaction.guildId,
    });

    await interaction.editReply({
      content: result.content,
      ...(result.embeds ? { embeds: result.embeds as never } : {}),
    });
  } catch (error) {
    console.error("[discord] command failed:", error instanceof Error ? error.message : error);
    const message = "Something went wrong saving that. Nothing was written.";
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: message }).catch(() => {});
    } else {
      await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
    }
  }
});

client.on(Events.MessageCreate, async (message: Message) => {
  if (message.author.bot) return;

  const isDm = !message.guildId;
  const mentionsBot = client.user ? message.mentions.has(client.user) : false;
  const inConfiguredGuild = Boolean(config.discord.guildId && message.guildId === config.discord.guildId);

  // Only DMs (when explicitly enabled) and @mentions inside the configured
  // guild are treated as writing.
  if (isDm && !captureDms) return;
  if (!isDm && !(mentionsBot && inConfiguredGuild)) return;

  const text = mentionsBot && client.user
    ? message.content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim()
    : message.content.trim();
  if (!text) return;

  try {
    const link = await prisma.discordLink.findUnique({
      where: { discordUserId: message.author.id },
      include: { user: { include: { settings: true } } },
    });

    if (!link) {
      await message.reply(
        "I don't know whose diary this is yet.\nOpen the diary → Settings → Discord, generate a code, then run `/link <code>`.",
      );
      return;
    }

    // Idempotency: a Discord resend or our own retry cannot duplicate an entry.
    const sourceRef = `discord:${message.id}`;
    const existing = await prisma.entry.findFirst({ where: { userId: link.user.id, sourceRef } });
    if (existing) return;

    const parsed = parseCapture(text);
    if (parsed.isCommand) {
      await message.reply("Nothing to save from that message.");
      return;
    }

    const timezone = link.user.settings?.timezone ?? link.user.timezone;
    const entry = await createEntry(link.user.id, timezone, {
      content: parsed.content,
      title: parsed.title,
      entryType: parsed.entryType,
      mood: parsed.mood,
      tags: parsed.tags,
      occurredAt: message.createdAt,
      source: "discord",
      sourceRef,
    });

    if (parsed.createThought) {
      await prisma.unresolvedThought.create({
        data: {
          userId: link.user.id,
          question: parsed.content.slice(0, 400),
          firstEntryId: entry.id,
          lastEntryId: entry.id,
        },
      });
    }

    const day = dayKey(message.createdAt, timezone);
    await message.reply(
      [
        `📖 Saved · **${day}** · ${entry.wordCount} words`,
        parsed.tags.length ? parsed.tags.map((t) => `#${t}`).join(" ") : "",
        parsed.createThought ? "Tracked as an unresolved thought." : "",
        `[Open in diary](${config.appUrl}/entry/${entry.id})`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  } catch (error) {
    console.error("[discord] capture failed:", error instanceof Error ? error.message : error);
    await message.reply("Couldn't save that — nothing was written. Try again.").catch(() => {});
  }
});

async function shutdown(signal: string) {
  console.log(`\n${signal} — shutting down.`);
  await client.destroy();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

client.login(config.discord.token).catch((error) => {
  console.error("[discord] login failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
