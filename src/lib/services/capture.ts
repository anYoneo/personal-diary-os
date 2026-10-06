/**
 * Discord quick-capture parsing. Pure functions so they are testable without a
 * bot connection: the bot supplies text + metadata, this decides what the entry
 * becomes and what metadata gets stored.
 */

import { dayKey } from "../day";

export type CaptureKind =
  | "entry"
  | "idea"
  | "problem"
  | "goal"
  | "achievement"
  | "lesson"
  | "reflection"
  | "question";

type PrefixRule = { pattern: RegExp; kind: CaptureKind; entryType: string; strip: boolean };

const PREFIX_RULES: PrefixRule[] = [
  { pattern: /^(?:remember (?:this|that)|remember|note to self|note|rmb|save this)[:,]?\s+/i, kind: "entry", entryType: "daily", strip: true },
  { pattern: /^idea[:,]?\s+/i, kind: "idea", entryType: "idea", strip: true },
  { pattern: /^(?:problem|issue|blocker)[:,]?\s+/i, kind: "problem", entryType: "problem", strip: true },
  { pattern: /^(?:goal|target)[:,]?\s+/i, kind: "goal", entryType: "goal", strip: true },
  { pattern: /^(?:achievement|win|shipped)[:,]?\s+/i, kind: "achievement", entryType: "achievement", strip: true },
  { pattern: /^(?:lesson|learned|takeaway)[:,]?\s+/i, kind: "lesson", entryType: "lesson", strip: true },
  { pattern: /^(?:reflection|reflect)[:,]?\s+/i, kind: "reflection", entryType: "reflection", strip: true },
  { pattern: /^(?:question|wondering|unresolved)[:,]?\s+/i, kind: "question", entryType: "reflection", strip: true },
];

export type ParsedCapture = {
  kind: CaptureKind;
  entryType: string;
  content: string;
  title: string | null;
  /** Inline #tags found anywhere in the text. */
  tags: string[];
  mood: string | null;
  /** True when the user asked for an unresolved thought to be created. */
  createThought: boolean;
  /** True when the text should not be treated as a new entry (pure command). */
  isCommand: boolean;
};

const MOOD_LOOKUP: Record<string, string> = {
  great: "great", good: "good", neutral: "neutral", low: "low", sad: "sad",
  angry: "angry", anxious: "anxious", motivated: "motivated", reflective: "reflective",
};

/**
 * Parse a Discord message into a capture. Rules:
 *  - "remember ...", "idea:", "goal:" etc. set the kind and are stripped.
 *  - #tags become tags, and a leading "mood:x" or an emoji maps to mood.
 *  - everything else is plain text; the bot never invents tags or summaries.
 */
export function parseCapture(raw: string): ParsedCapture {
  let text = raw.trim();
  let kind: CaptureKind = "entry";
  let entryType = "daily";

  for (const rule of PREFIX_RULES) {
    if (rule.pattern.test(text)) {
      kind = rule.kind;
      entryType = rule.entryType;
      if (rule.strip) text = text.replace(rule.pattern, "");
      break;
    }
  }

  // Mood: explicit "mood: anxious" anywhere in the message.
  let mood: string | null = null;
  const moodMatch = text.match(/\bmood[:=]\s*([a-z]+)/i);
  if (moodMatch) {
    const key = moodMatch[1].toLowerCase();
    if (MOOD_LOOKUP[key]) {
      mood = MOOD_LOOKUP[key];
      text = text.replace(moodMatch[0], "").trim();
    }
  }

  // Inline #tags (Discord users know this convention).
  const tags = [...text.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]{1,40})/gu)].map((m) => m[1]);
  const withoutTags = text.replace(/(?:^|\s)#[\p{L}\p{N}_-]{1,40}/gu, " ").replace(/\s+/g, " ").trim();

  const createThought = kind === "question";
  const isCommand = withoutTags.length === 0;

  const firstSentence = withoutTags.split(/[.!?\n]/)[0]?.trim() ?? "";
  const title =
    firstSentence.length >= 3 && firstSentence.length <= 90 && withoutTags.length > 120
      ? firstSentence
      : null;

  return {
    kind,
    entryType,
    content: withoutTags,
    title,
    tags: [...new Set(tags.map((t) => t.toLowerCase()))],
    mood,
    createThought,
    isCommand,
  };
}

/** Message shown back in Discord after a capture — confirms what was stored. */
export function captureConfirmation(params: {
  day: string;
  words: number;
  tags: string[];
  entryId: string;
  appUrl: string;
  mood: string | null;
}): string {
  const lines = [
    "📖 Saved to your diary",
    `**${params.day}** · ${params.words} words${params.mood ? ` · mood: ${params.mood}` : ""}`,
  ];
  if (params.tags.length) lines.push(params.tags.map((t) => `#${t}`).join(" "));
  lines.push(`[Open diary](${params.appUrl}/entry/${params.entryId})`);
  return lines.join("\n");
}

/**
 * Resolve which user a Discord message belongs to. Only linked accounts can
 * write; anything else is refused with instructions rather than silently stored.
 */
export async function userForDiscord(
  prismaClient: {
    discordLink: { findUnique: (args: { where: { discordUserId: string }; include: { user: { include: { settings: true } } } }) => Promise<unknown> };
  },
  discordUserId: string,
) {
  const link = (await prismaClient.discordLink.findUnique({
    where: { discordUserId },
    include: { user: { include: { settings: true } } },
  })) as {
    user: { id: string; timezone: string; settings: { timezone: string } | null };
  } | null;
  if (!link) return null;
  return {
    id: link.user.id,
    timezone: link.user.settings?.timezone ?? link.user.timezone,
  };
}

export function dayForCapture(date: Date, timezone: string): string {
  return dayKey(date, timezone);
}
