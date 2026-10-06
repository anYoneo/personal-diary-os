/**
 * Environment access in one place. Values are never printed; the UI only ever
 * sees booleans like `discordConfigured`.
 */

// Import + call this HERE, not from the entry points: ES module imports are
// hoisted, so a `loadProcessEnv()` call placed after an import of this module
// would run too late and `config` would already hold empty strings.
// (Harmless under `next dev`, which has already loaded .env; dotenv never
// overwrites values that are already set.)
import { loadProcessEnv } from "./load-env";
loadProcessEnv();

function raw(key: string): string {
  return (process.env[key] ?? "").trim();
}

export const config = {
  appUrl: raw("APP_URL") || "http://localhost:3111",
  isProd: process.env.NODE_ENV === "production",
  // Operator of this instance: the only account allowed to mint invite codes.
  // Defaults to the seeded owner email.
  betaAdminEmail: raw("BETA_ADMIN_EMAIL") || raw("ADMIN_EMAIL") || "",
  // Set COOKIE_SECURE="false" when the app is served over plain HTTP (a host
  // that only gives you a port-80 subdomain). Defaults to secure in production.
  // Behind a TLS-terminating tunnel you do NOT need to set anything.
  cookieSecure: raw("COOKIE_SECURE").toLowerCase() === "false" ? false : process.env.NODE_ENV === "production",
  timezone: raw("USER_TIMEZONE") || "Asia/Jakarta",
  discord: {
    token: raw("DISCORD_BOT_TOKEN"),
    applicationId: raw("DISCORD_APPLICATION_ID"),
    notifyChannelId: raw("DISCORD_NOTIFY_CHANNEL_ID"),
    publicKey: raw("DISCORD_PUBLIC_KEY"),
    guildId: raw("DISCORD_GUILD_ID"),
  },
  ai: {
    // Any OpenAI-compatible endpoint. AI_BASE_URL wins; AI_PROVIDER is accepted
    // as the base URL too, so either naming in .env works.
    baseUrl: raw("AI_BASE_URL") || raw("AI_PROVIDER"),
    apiKey: raw("AI_API_KEY"),
    model: raw("AI_MODEL"),
  },
};

export const discordConfigured = (): boolean =>
  Boolean(config.discord.token && config.discord.applicationId);

export const aiConfigured = (): boolean =>
  Boolean(config.ai.baseUrl && config.ai.apiKey && config.ai.model);
