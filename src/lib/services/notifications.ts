import { prisma } from "../db";
import { config } from "../config";
import { TIMEZONE, localHour } from "../day";
import { excerpt, titleOrExcerpt } from "../markdown";
import { discordDeliveryEnabled } from "../notify";

/**
 * Notification queue. Producers (entry created, reminder due, reflection jobs)
 * write a row; the Discord worker drains it. Discord transport never appears in
 * diary business logic, and everything still works with no bot configured —
 * rows simply sit as `skipped` until a worker exists.
 */
export type OutboxKind =
  | "entry.created"
  | "reminder.due"
  | "reflection.weekly"
  | "reflection.monthly"
  | "memory.on_this_day"
  | "thought.followup";

export type OutboxPayload = Record<string, unknown>;

export async function enqueue(
  userId: string,
  kind: OutboxKind,
  payload: OutboxPayload,
  options: { entryId?: string; scheduledFor?: Date } = {},
): Promise<void> {
  try {
    await prisma.notificationOutbox.create({
      data: {
        userId,
        kind,
        payload: JSON.stringify(payload),
        entryId: options.entryId ?? null,
        scheduledFor: options.scheduledFor ?? new Date(),
      },
    });
  } catch (error) {
    // Losing a notification must never lose the diary entry itself.
    console.error(`[outbox] enqueue failed for ${kind}:`, error instanceof Error ? error.message : error);
  }
}

/** True when the current local hour sits inside the user's quiet hours. */
export function inQuietHours(
  now: Date,
  settings: { quietHoursStart: number | null; quietHoursEnd: number | null } | null,
  timeZone: string = TIMEZONE,
): boolean {
  if (!settings) return false;
  const { quietHoursStart: start, quietHoursEnd: end } = settings;
  if (start === null || end === null) return false;
  const hour = localHour(now, timeZone);
  return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
}

export async function enqueueEntryCreated(
  userId: string,
  entry: { id: string; day: string; title: string | null; content: string; wordCount: number },
  user?: { email: string },
): Promise<void> {
  // Invitees keep the whole app but get no Discord delivery — see lib/notify.ts
  // for why (one global channel, so a second account's excerpts would land in
  // the operator's DM while the register page promises per-account privacy).
  // Skipping at the producer means no diary text is ever queued for them.
  if (user && !discordDeliveryEnabled(user)) return;

  const settings = await prisma.userSettings.findUnique({ where: { userId } });
  if (settings && !settings.notifyOnEntry) return;
  if (inQuietHours(new Date(), settings, settings?.timezone ?? TIMEZONE)) {
    // Still queued — the worker holds it until morning.
    await enqueue(
      userId,
      "entry.created",
      {
        day: entry.day,
        title: titleOrExcerpt(entry.title, entry.content),
        preview: excerpt(entry.content, 220),
        wordCount: entry.wordCount,
      },
      { entryId: entry.id, scheduledFor: new Date(Date.now() + 8 * 3_600_000) },
    );
    return;
  }
  await enqueue(
    userId,
    "entry.created",
    {
      day: entry.day,
      title: titleOrExcerpt(entry.title, entry.content),
      preview: excerpt(entry.content, 220),
      wordCount: entry.wordCount,
    },
    { entryId: entry.id },
  );
}

export async function pendingNotifications(limit = 20) {
  const now = new Date();
  return prisma.notificationOutbox.findMany({
    where: { status: "pending", scheduledFor: { lte: now } },
    orderBy: { scheduledFor: "asc" },
    take: limit,
    include: { user: { include: { discord: true } } },
  });
}

export async function markNotificationSent(id: string, deliveryId: string | null): Promise<void> {
  await prisma.notificationOutbox.update({
    where: { id },
    data: {
      status: "sent",
      sentAt: new Date(),
      attempts: { increment: 1 },
      error: deliveryId,
    },
  });
}

export async function markNotificationFailed(id: string, message: string): Promise<void> {
  const row = await prisma.notificationOutbox.findUnique({ where: { id } });
  const attempts = (row?.attempts ?? 0) + 1;
  await prisma.notificationOutbox.update({
    where: { id },
    data: {
      attempts,
      error: message.slice(0, 300),
      // Give up after 5 tries so a broken webhook can't loop forever.
      status: attempts >= 5 ? "failed" : "pending",
      scheduledFor: new Date(Date.now() + Math.min(attempts, 5) * 60_000),
    },
  });
}

export async function markNotificationSkipped(id: string, reason: string): Promise<void> {
  await prisma.notificationOutbox.update({
    where: { id },
    data: { status: "skipped", error: reason.slice(0, 300), attempts: { increment: 1 } },
  });
}

/** Deep link used inside Discord messages. */
export function entryUrl(entryId: string): string {
  return `${config.appUrl}/entry/${entryId}`;
}

export function todayUrl(): string {
  return `${config.appUrl}/write`;
}
