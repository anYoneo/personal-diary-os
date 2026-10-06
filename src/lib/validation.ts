import { z } from "zod";

export const ENTRY_TYPES = [
  "daily",
  "reflection",
  "idea",
  "work",
  "personal",
  "goal",
  "achievement",
  "problem",
  "lesson",
  "random",
] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

export const MOODS = [
  { key: "great", emoji: "😀", label: "Great" },
  { key: "good", emoji: "🙂", label: "Good" },
  { key: "neutral", emoji: "😐", label: "Neutral" },
  { key: "low", emoji: "😕", label: "Low" },
  { key: "sad", emoji: "😔", label: "Sad" },
  { key: "angry", emoji: "😡", label: "Angry" },
  { key: "anxious", emoji: "😰", label: "Anxious" },
  { key: "motivated", emoji: "🔥", label: "Motivated" },
  { key: "reflective", emoji: "🧠", label: "Reflective" },
] as const;

export const MOOD_KEYS = MOODS.map((m) => m.key) as unknown as [string, ...string[]];

export const moodMeta = (key: string | null | undefined) =>
  MOODS.find((m) => m.key === key) ?? null;

const tagSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .transform((t) => t.replace(/^#/, ""));

/**
 * Field shapes with NO defaults.
 *
 * Why this exists: in Zod 4, `.partial()` keeps `.default()` values. Building the
 * PATCH schema straight from the create schema therefore injects
 * `entryType: "daily"` and `tags: []` into every autosave that omits them —
 * silently resetting the entry type and wiping its tags. The update schema is
 * built from these shapes instead, and the create schema applies the defaults.
 */
const entryFieldShapes = {
  title: z.string().trim().max(200).nullable(),
  content: z.string().trim().min(1, "Write something first").max(200_000),
  entryType: z.enum(ENTRY_TYPES),
  mood: z.enum(MOOD_KEYS).nullable(),
  occurredAt: z.coerce.date(),
  location: z.string().trim().max(120).nullable(),
  isImportant: z.boolean(),
  tags: z.array(tagSchema).max(30),
  threadIds: z.array(z.string().min(1)).max(20),
  source: z.enum(["web", "discord", "api"]),
  sourceRef: z.string().max(200).nullable(),
  dedupeBySourceRef: z.boolean(),
};

export const entryCreateSchema = z.object({
  title: entryFieldShapes.title.optional(),
  content: entryFieldShapes.content,
  entryType: entryFieldShapes.entryType.default("daily"),
  mood: entryFieldShapes.mood.optional(),
  occurredAt: entryFieldShapes.occurredAt.optional(),
  location: entryFieldShapes.location.optional(),
  isImportant: entryFieldShapes.isImportant.optional().default(false),
  tags: entryFieldShapes.tags.optional().default([]),
  threadIds: entryFieldShapes.threadIds.optional().default([]),
  source: entryFieldShapes.source.optional().default("web"),
  sourceRef: entryFieldShapes.sourceRef.optional(),
  /** Set for Discord quick-capture idempotency (unique sourceRef lookup upstream). */
  dedupeBySourceRef: entryFieldShapes.dedupeBySourceRef.optional().default(false),
});
export type EntryCreateInput = z.infer<typeof entryCreateSchema>;

/**
 * PATCH accepts only what the caller actually sent. Absent keys must stay
 * absent — the services treat `undefined` as "leave it alone".
 */
export const entryUpdateSchema = z.object({
  title: entryFieldShapes.title.optional(),
  // An autosave may legitimately clear the body down to nothing.
  content: z.string().max(200_000).optional(),
  entryType: entryFieldShapes.entryType.optional(),
  mood: entryFieldShapes.mood.optional(),
  occurredAt: entryFieldShapes.occurredAt.optional(),
  location: entryFieldShapes.location.optional(),
  isImportant: entryFieldShapes.isImportant.optional(),
  tags: entryFieldShapes.tags.optional(),
  threadIds: entryFieldShapes.threadIds.optional(),
  expectedVersion: z.number().int().positive().optional(),
});

export const entryQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  type: z.enum(ENTRY_TYPES).optional(),
  mood: z.enum(MOOD_KEYS).optional(),
  tag: z.string().trim().max(40).optional(),
  thread: z.string().trim().max(80).optional(),
  important: z.coerce.boolean().optional(),
  /** Include soft-deleted entries (trash view). */
  trash: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(30),
  cursor: z.string().optional(),
  order: z.enum(["desc", "asc"]).optional().default("desc"),
});

export const threadSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(["life", "project", "person", "place", "topic"]).default("topic"),
  description: z.string().trim().max(500).optional().nullable(),
  color: z.string().trim().max(20).optional().nullable(),
  status: z.enum(["active", "dormant", "archived"]).default("active"),
});

export const goalSchema = z.object({
  title: z.string().trim().min(1).max(200),
  detail: z.string().trim().max(2000).optional().nullable(),
  threadId: z.string().optional().nullable(),
  targetDate: z.coerce.date().optional().nullable(),
});

export const thoughtSchema = z.object({
  question: z.string().trim().min(1).max(400),
  note: z.string().trim().max(2000).optional().nullable(),
  threadId: z.string().optional().nullable(),
});

export const reminderSchema = z.object({
  text: z.string().trim().min(1).max(400),
  remindAt: z.coerce.date(),
  recurrence: z.enum(["none", "daily", "weekly", "monthly"]).default("none"),
});

export const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(200),
});

/**
 * Registration is invite-only. The invite code is the gate; without a valid one
 * no account can be created on the instance.
 */
export const registerSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8, "Use at least 8 characters.").max(200),
  inviteCode: z.string().trim().min(4).max(40),
  name: z.string().trim().max(80).optional(),
  timezone: z.string().trim().max(64).optional(),
});

export const settingsSchema = z.object({
  timezone: z.string().trim().max(64).optional(),
  notifyOnEntry: z.boolean().optional(),
  notifyOnReminder: z.boolean().optional(),
  weeklyReflection: z.boolean().optional(),
  onThisDay: z.boolean().optional(),
  reflectionPrompt: z.boolean().optional(),
  reflectionPromptEnabled: z.boolean().optional(),
  quietHoursStart: z.coerce.number().int().min(0).max(23).optional().nullable(),
  quietHoursEnd: z.coerce.number().int().min(0).max(23).optional().nullable(),
});
