import { config } from "@/lib/config";
import { longDate, shortDate } from "@/lib/day";
import type { OutboxKind } from "@/lib/services/notifications";

/**
 * Outbox payload → Discord message. Pure formatting so it can be unit tested and
 * so the transport layer stays dumb.
 */

export type DiscordMessage = { content: string; embeds?: Record<string, unknown>[] };

const ACCENT = 0xd8b26a;

export function renderNotification(kind: string, payload: Record<string, unknown>): DiscordMessage {
  switch (kind as OutboxKind) {
    case "entry.created": {
      const day = String(payload.day ?? "");
      const title = String(payload.title ?? "New entry");
      const preview = String(payload.preview ?? "");
      const words = Number(payload.wordCount ?? 0);
      return {
        content: `📖 New diary entry saved`,
        embeds: [
          {
            title,
            description: preview.slice(0, 1500),
            color: ACCENT,
            footer: { text: `${longDate(day)} · ${words} words` },
            url: payload.entryId ? `${config.appUrl}/entry/${payload.entryId}` : config.appUrl,
          },
        ],
      };
    }

    case "reminder.due": {
      const text = String(payload.text ?? "Reminder");
      return {
        content: `⏰ **Reminder**\n${text}`,
      };
    }

    case "reflection.weekly":
    case "reflection.monthly": {
      const label = kind === "reflection.weekly" ? "Weekly reflection" : "Monthly reflection";
      const entryCount = Number(payload.entryCount ?? 0);
      const words = Number(payload.words ?? 0);
      const tags = Array.isArray(payload.tags) ? (payload.tags as string[]).slice(0, 6) : [];
      const lines = [
        `🧠 **${label}**`,
        `You wrote ${entryCount} ${entryCount === 1 ? "entry" : "entries"} · ${words.toLocaleString("en-US")} words`,
      ];
      if (tags.length) lines.push(`Recurring: ${tags.map((t) => `#${t}`).join(" ")}`);
      lines.push(`[View the facts](${config.appUrl}/insights)`);
      return { content: lines.join("\n") };
    }

    case "memory.on_this_day": {
      const day = String(payload.day ?? "");
      return {
        content: `🕰️ **On this day**`,
        embeds: [
          {
            title: String(payload.title ?? "A memory"),
            description: String(payload.preview ?? "").slice(0, 1200),
            color: ACCENT,
            footer: { text: shortDate(day) },
            url: payload.entryId ? `${config.appUrl}/entry/${payload.entryId}` : config.appUrl,
          },
        ],
      };
    }

    case "thought.followup": {
      return {
        content: `🧩 Still open: **${String(payload.question ?? "An unresolved thought")}**\nLast mentioned ${String(payload.lastMention ?? "a while ago")}.\n[Review it](${config.appUrl}/thoughts)`,
      };
    }

    default:
      return { content: `(unhandled notification: ${kind})` };
  }
}
