import { REST, Routes } from "discord.js";
import { config, discordConfigured } from "@/lib/config";
import { commandDefinitions } from "./commands";

/**
 * Registers the diary's slash commands.
 *
 * PUT /applications/{id}/commands is a FULL OVERWRITE of that scope: whatever is
 * not in the request body is DELETED. Our token is shared with the Hermes
 * gateway bot, whose 75 global commands live in the same application — so a
 * naive global PUT would silently destroy them. Guardrails:
 *
 *   - registration is guild-scoped by default (DISCORD_GUILD_ID), never global
 *   - before writing, the existing command list is fetched, and commands that
 *     are not ours are PRESERVED by merging them into the request body
 *   - writes to the global scope additionally require --allow-global
 *
 * Usage: npm run discord:register [-- --allow-global]
 */
const OURS: Set<string> = new Set(commandDefinitions.map((c) => c.name));

async function main() {
  if (!discordConfigured()) {
    console.error("Set DISCORD_BOT_TOKEN and DISCORD_APPLICATION_ID in .env first.");
    process.exit(1);
  }

  const allowGlobal = process.argv.includes("--allow-global");
  // Default to guild scope; global is opt-in because it cannot be undone by
  // simply re-running this script.
  const guildId = config.discord.guildId || "";
  const useGlobal = allowGlobal && !guildId;

  const rest = new REST({ version: "10" }).setToken(config.discord.token);
  const route = useGlobal
    ? Routes.applicationCommands(config.discord.applicationId)
    : Routes.applicationGuildCommands(config.discord.applicationId, guildId);

  if (!useGlobal && !guildId) {
    console.error(
      "No DISCORD_GUILD_ID set. Registering globally would overwrite every command\n"
        + "in this application, including another bot's. Set DISCORD_GUILD_ID, or\n"
        + "re-run with --allow-global if you truly mean it.",
    );
    process.exit(1);
  }

  // Preserve commands that aren't ours — this app's token is shared.
  const existing = (await rest.get(route)) as Array<{ name: string }>;
  const foreign = existing.filter((c) => !OURS.has(c.name));
  if (foreign.length) {
    console.log(
      `Preserving ${foreign.length} unrelated command(s) already in this scope: ${foreign.map((c) => c.name).join(", ")}`,
    );
  }

  const body = [
    ...foreign,
    ...commandDefinitions.map((command) => ({
      ...command,
      options: command.options ? [...command.options] : [],
    })),
  ];

  const result = (await rest.put(route, { body })) as unknown[];
  console.log(
    `Registered ${commandDefinitions.length} diary commands `
      + `${useGlobal ? "globally" : `in guild ${guildId}`} (${result.length} total in scope).`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
