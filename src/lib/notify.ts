import { config } from "./config";

/**
 * Who may receive Discord notifications from this instance.
 *
 * Why this exists: DISCORD_NOTIFY_CHANNEL_ID is a single value in .env — one
 * destination for the whole server. Before this gate, any second account that
 * wrote an entry had its excerpt posted to that channel, which on a personal
 * instance is the operator's own DM. A new user was told their writing was
 * private to their account while its preview was landing in someone else's
 * inbox.
 *
 * So delivery is operator-only, deliberately. Invitees still get the whole app
 * (entries, reminders, search, the web UI) — they simply receive nothing on
 * Discord, instead of receiving it in the wrong place. Reminders still come due;
 * they are marked skipped, which is visible in Settings → outbox.
 *
 * If per-user channels are ever added (a DiscordLink.dmChannelId set by each
 * user's own /link), replace the predicate here — the call sites do not change.
 *
 * Kept free of Next-only imports so the worker process can use it too.
 */
export function isInstanceOperator(user: { email: string }): boolean {
  const operator = config.betaAdminEmail.trim().toLowerCase();
  return operator.length > 0 && user.email.trim().toLowerCase() === operator;
}

/** The single authority for "does this user get Discord notifications?". */
export function discordDeliveryEnabled(user: { email: string }): boolean {
  return isInstanceOperator(user);
}
