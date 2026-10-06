import { prisma } from "@/lib/db";
import { config, discordConfigured } from "@/lib/config";
import { dayKey, longDate, relativeDay, shortDate } from "@/lib/day";
import { createEntry } from "@/lib/services/entries";
import { searchEntries } from "@/lib/services/memory";
import { randomMemory, forwardMemory, lifeThreads } from "@/lib/services/memory-graph";
import { insights } from "@/lib/services/insights";
import { parseCapture, dayForCapture } from "@/lib/services/capture";
import { excerpt } from "@/lib/markdown";
import { moodMeta } from "@/lib/validation";

/**
 * One implementation of every Discord command, shared by the gateway bot and the
 * HTTP interactions endpoint. Returns plain content + optional embed so either
 * transport can render it.
 */

export type CommandResult = {
  content: string;
  embeds?: Record<string, unknown>[];
  ephemeral?: boolean;
};

export type CommandInput = {
  name: string;
  options: Record<string, string>;
  discordUserId: string;
  username: string | null;
  guildId: string | null;
};

const NO_LINK =
  "Your Discord account isn't linked yet.\nOpen Settings → Discord in the diary, generate a code, then run `/link <code>`.";

async function linkedUser(discordUserId: string) {
  const link = await prisma.discordLink.findUnique({
    where: { discordUserId },
    include: { user: { include: { settings: true } } },
  });
  if (!link) return null;
  return {
    id: link.user.id,
    timezone: link.user.settings?.timezone ?? link.user.timezone,
  };
}

function moodLine(mood: string | null): string {
  const meta = moodMeta(mood);
  return meta ? `${meta.emoji} ${meta.label}` : "—";
}

export async function executeCommand(input: CommandInput): Promise<CommandResult> {
  const user = await linkedUser(input.discordUserId);

  // /link is the only command that works before the account is linked.
  if (input.name === "link") return linkAccount(input);

  if (!user) return { content: NO_LINK, ephemeral: true };

  switch (input.name) {
    case "diary":
    case "today":
      return todayEntry(user.id, user.timezone);
    case "write":
      return writeEntry(user.id, user.timezone, input);
    case "search":
      return searchDiary(user.id, input.options.query ?? "");
    case "remember":
      return remember(user.id, input.options.keyword ?? "");
    case "random":
      return random(user.id, user.timezone);
    case "stats":
      return stats(user.id, user.timezone);
    case "goal":
      return goals(user.id);
    case "threads":
      return threads(user.id);
    case "reflect":
      return reflectionStub();
    case "remind":
      return remind(user.id, input.options.text ?? "", input.options.when ?? "");
    default:
      return { content: `Unknown command \`/${input.name}\`.`, ephemeral: true };
  }
}

/** /link <code> — consumes a code generated in the webapp. */
async function linkAccount(input: CommandInput): Promise<CommandResult> {
  const code = (input.options.code ?? "").trim().toUpperCase();
  if (!code) return { content: "Usage: `/link <code>` (get the code from Settings → Discord).", ephemeral: true };

  const row = await prisma.linkCode.findUnique({ where: { code }, include: { user: true } });
  if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) {
    return { content: "That code is invalid or expired. Generate a new one in Settings.", ephemeral: true };
  }

  // One Discord account ↔ one diary account, and vice versa.
  await prisma.$transaction([
    prisma.discordLink.upsert({
      where: { userId: row.userId },
      create: {
        userId: row.userId,
        discordUserId: input.discordUserId,
        username: input.username,
        guildId: input.guildId,
      },
      update: { discordUserId: input.discordUserId, username: input.username, guildId: input.guildId },
    }),
    prisma.linkCode.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    prisma.auditLog.create({
      data: { userId: row.userId, action: "discord.link", entity: "user", entityId: row.userId },
    }),
  ]);

  return {
    content: `Linked. Your Discord account now writes to the diary as **${row.user.email}**.\nDM me anything and it becomes an entry — try \`idea: something worth keeping\`.`,
    ephemeral: true,
  };
}

async function todayEntry(userId: string, timezone: string): Promise<CommandResult> {
  const today = dayKey(new Date(), timezone);
  const entries = await prisma.entry.findMany({
    where: { userId, day: today, deletedAt: null },
    orderBy: { occurredAt: "asc" },
  });

  const openThoughts = await prisma.unresolvedThought.count({ where: { userId, status: "open" } });

  if (entries.length === 0) {
    return {
      content: `📖 **${longDate(today)}**\nNothing written yet today. ${openThoughts ? `(${openThoughts} unresolved thought${openThoughts === 1 ? "" : "s"} waiting.)` : ""}`,
    };
  }

  const words = entries.reduce((sum, e) => sum + e.wordCount, 0);
  return {
    content: `📖 **${longDate(today)}** · ${entries.length} ${entries.length === 1 ? "entry" : "entries"} · ${words} words`,
    embeds: entries.slice(0, 4).map((entry) => ({
      title: entry.title?.trim() || excerpt(entry.content, 70),
      description: excerpt(entry.content, 400),
      color: 0xd8b26a,
      footer: {
        text: `${entry.entryType}${entry.mood ? ` · ${entry.mood}` : ""} · ${entry.source === "discord" ? "from Discord" : "from web"} · ${entry.wordCount} words`,
      },
      url: `${config.appUrl}/entry/${entry.id}`,
    })),
  };
}

async function writeEntry(
  userId: string,
  timezone: string,
  input: CommandInput,
): Promise<CommandResult> {
  const text = input.options.text ?? "";
  const parsed = parseCapture(text);
  if (parsed.isCommand) {
    return { content: "Nothing to save — the message was empty after removing the prefix.", ephemeral: true };
  }

  const entry = await createEntry(userId, timezone, {
    content: parsed.content,
    title: parsed.title,
    entryType: parsed.entryType,
    mood: parsed.mood,
    tags: parsed.tags,
    occurredAt: new Date(),
    source: "discord",
    // Idempotency: retries and double-sends cannot create duplicate entries.
    sourceRef: `discord:${input.discordUserId}:${Date.now().toString(36)}`,
  });

  if (parsed.createThought) {
    await prisma.unresolvedThought.create({
      data: {
        userId,
        question: parsed.content.slice(0, 400),
        firstEntryId: entry.id,
        lastEntryId: entry.id,
      },
    });
  }

  const tags = parsed.tags.length ? `\n${parsed.tags.map((t) => `#${t}`).join(" ")}` : "";
  return {
    content: `📖 Saved · **${dayForCapture(new Date(), timezone)}** · ${entry.wordCount} words${parsed.mood ? ` · ${moodLine(parsed.mood)}` : ""}${tags}\n[Open in diary](${config.appUrl}/entry/${entry.id})${parsed.createThought ? "\nTracked as an unresolved thought." : ""}`,
    ephemeral: false,
  };
}

async function searchDiary(userId: string, query: string): Promise<CommandResult> {
  if (!query.trim()) return { content: "Give me something to search for.", ephemeral: true };
  const result = await searchEntries(userId, { q: query, limit: 5 });
  if (result.hits.length === 0) {
    return { content: `No entries match “${query}”. (${result.total} total matches in archive.)` };
  }
  return {
    content: `🔎 **${result.total}** ${result.total === 1 ? "entry" : "entries"} matching “${query}”`,
    embeds: result.hits.slice(0, 5).map((hit) => ({
      title: hit.title || "(untitled)",
      description: hit.excerpt.slice(0, 400),
      color: 0x8ab4e8,
      footer: { text: `${shortDate(hit.day)} · matched in ${hit.matchedIn}${hit.tags.length ? ` · #${hit.tags.join(" #")}` : ""}` },
      url: `${config.appUrl}/entry/${hit.id}`,
    })),
  };
}

async function remember(userId: string, keyword: string): Promise<CommandResult> {
  if (!keyword.trim()) return { content: "Usage: `/remember <keyword>`", ephemeral: true };
  const result = await searchEntries(userId, { q: keyword, limit: 5 });
  if (result.hits.length === 0) return { content: `Nothing in the archive mentions “${keyword}”.` };

  const days = result.hits.map((h) => h.day).sort();
  return {
    content: `🕰️ **${keyword}** · ${result.total} mentions · first ${shortDate(days[0])} · latest ${shortDate(days[days.length - 1])}`,
    embeds: result.hits.slice(0, 3).map((hit) => ({
      title: hit.title || "(untitled)",
      description: hit.excerpt.slice(0, 400),
      color: 0xd8b26a,
      footer: { text: shortDate(hit.day) },
      url: `${config.appUrl}/entry/${hit.id}`,
    })),
  };
}

async function random(userId: string, timezone: string): Promise<CommandResult> {
  const today = dayKey(new Date(), timezone);
  const memory = (await forwardMemory(userId, today)) ?? (await randomMemory(userId));
  if (!memory) {
    return {
      content:
        "Nothing to resurface yet — memories start appearing once you have entries older than a month.",
    };
  }
  return {
    content: `🕰️ **${memory.label}**${memory.note ? ` · ${memory.note}` : ""}`,
    embeds: [
      {
        title: memory.entry.title,
        description: memory.entry.excerpt.slice(0, 900),
        color: 0xd8b26a,
        footer: { text: `${memory.entry.entryType} · ${memory.entry.wordCount} words` },
        url: `${config.appUrl}/entry/${memory.entry.id}`,
      },
    ],
  };
}

async function stats(userId: string, timezone: string): Promise<CommandResult> {
  const today = dayKey(new Date(), timezone);
  const report = await insights(userId, today);
  const lines = [
    `📊 **Diary**`,
    `${report.totals.entries} entries · ${report.totals.words.toLocaleString("en-US")} words · ${report.totals.days} days written`,
    `Avg ${report.totals.avgWords} words/entry · longest streak ${report.streaks.longest} days`,
    `This week ${report.cadence.thisWeek} · last week ${report.cadence.lastWeek}`,
  ];
  if (report.topTags.length) {
    lines.push(`Top tags: ${report.topTags.slice(0, 5).map((t) => `#${t.slug}`).join(" ")}`);
  }
  if (report.cadence.silenceDays) {
    lines.push(`Quiet since ${shortDate(report.cadence.silenceDays.since)}.`);
  }
  return { content: lines.join("\n") };
}

async function goals(userId: string): Promise<CommandResult> {
  const rows = await prisma.goal.findMany({
    where: { userId, status: { not: "dropped" } },
    include: { thread: { select: { name: true } } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 15,
  });
  if (rows.length === 0) return { content: "No goals recorded yet. Add one in the webapp." };

  const open = rows.filter((g) => g.status === "open");
  const done = rows.filter((g) => g.status === "done");
  const body = [
    open.length ? `**Open**\n${open.map((g) => `· ${g.title}${g.thread ? ` _(${g.thread.name})_` : ""}`).join("\n")}` : "",
    done.length ? `**Done** (${done.length})\n${done.slice(0, 5).map((g) => `· ~~${g.title}~~`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return { content: `🎯 ${body}` };
}

async function threads(userId: string): Promise<CommandResult> {
  const rows = (await lifeThreads(userId)).filter((t) => t.mentions > 0).slice(0, 8);
  if (rows.length === 0) {
    return { content: "No life threads have entries yet. Create threads in the webapp and tag entries with them." };
  }
  return {
    content: `🧵 **Life threads**\n${rows
      .map(
        (t) =>
          `· **${t.name}** — ${t.mentions} ${t.mentions === 1 ? "entry" : "entries"} · ${t.first ? shortDate(t.first) : "—"} → ${t.last ? relativeDay(t.last, dayKey(new Date())) : "—"}`,
      )
      .join("\n")}`,
  };
}

/** /reflect intentionally reports the facts only — narrative needs AI configured. */
async function reflectionStub(): Promise<CommandResult> {
  return {
    content:
      "🧠 Reflections with generated narrative need an AI provider configured (`AI_PROVIDER`/`AI_API_KEY`/`AI_MODEL`).\nUntil then use `/stats` for the facts and open **Insights → Weekly facts** in the webapp.",
    ephemeral: true,
  };
}

async function remind(userId: string, text: string, when: string): Promise<CommandResult> {
  if (!text.trim()) return { content: "Usage: `/remind <text> in <hours>`", ephemeral: true };

  // Accepts "in 3h", "3h", "in 2d" — anything else means one hour.
  const match = when.match(/(\d+(?:\.\d+)?)\s*([hdm])?/i);
  const amount = match ? Number(match[1]) : 1;
  const unit = (match?.[2] ?? "h").toLowerCase();
  const ms = unit === "d" ? amount * 86_400_000 : unit === "m" ? amount * 60_000 : amount * 3_600_000;
  const remindAt = new Date(Date.now() + ms);

  // The reminder table is driven by the worker; Discord delivery depends on the
  // outbox being drained (see `npm run worker`).
  const reminder = await prisma.reminder.create({
    data: { userId, text: text.slice(0, 400), remindAt },
  });
  await prisma.notificationOutbox.create({
    data: {
      userId,
      kind: "reminder.due",
      payload: JSON.stringify({ reminderId: reminder.id, text: reminder.text }),
      scheduledFor: remindAt,
    },
  });

  const minutes = Math.round(ms / 60_000);
  return {
    content: `⏰ Set for ${minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} h`} from now (${remindAt.toISOString()}).\nDelivered here if the worker is running and Discord is configured.`,
  };
}

export const commandDefinitions = [
  { name: "diary", description: "Show today's diary", options: [] },
  { name: "today", description: "Show today's entry", options: [] },
  {
    name: "write",
    description: "Write a diary entry without leaving Discord",
    options: [{ name: "text", description: "What happened?", type: 3, required: true }],
  },
  {
    name: "search",
    description: "Search your diary",
    options: [{ name: "query", description: "Words to look for", type: 3, required: true }],
  },
  {
    name: "remember",
    description: "Find what you wrote about a keyword",
    options: [{ name: "keyword", description: "Topic, project or person", type: 3, required: true }],
  },
  { name: "random", description: "Resurface an old memory", options: [] },
  { name: "stats", description: "Diary statistics", options: [] },
  { name: "goal", description: "Show your goals", options: [] },
  { name: "threads", description: "Show your life threads", options: [] },
  { name: "reflect", description: "Explain how to get a reflection", options: [] },
  {
    name: "remind",
    description: "Set a reminder in Discord",
    options: [
      { name: "text", description: "What should I remind you about?", type: 3, required: true },
      { name: "when", description: "e.g. 3h, 2d (default 1h)", type: 3, required: false },
    ],
  },
  {
    name: "link",
    description: "Link your Discord account to your diary",
    options: [{ name: "code", description: "Code from Settings → Discord", type: 3, required: true }],
  },
] as const;

export const discordReady = discordConfigured;

/** Wrap a command result in the interaction-response envelope. */
export function asInteractionResponse(result: CommandResult) {
  return {
    type: 4,
    data: {
      content: result.content,
      ...(result.embeds ? { embeds: result.embeds } : {}),
      ...(result.ephemeral ? { flags: 64 } : {}),
    },
  };
}

export async function runCommand(input: CommandInput) {
  return asInteractionResponse(await executeCommand(input));
}
