import { config, discordConfigured } from "@/lib/config";
import { prisma } from "@/lib/db";
import { addDays, dayKey, localHour, relativeDay, shortDate } from "@/lib/day";
import { excerpt, titleOrExcerpt } from "@/lib/markdown";
import {
  markNotificationFailed,
  markNotificationSent,
  markNotificationSkipped,
  pendingNotifications,
} from "@/lib/services/notifications";
import { reflectionFacts } from "@/lib/services/insights";
import { renderNotification, type DiscordMessage } from "@/discord/notify";
import { discordDeliveryEnabled } from "@/lib/notify";

/**
 * Background worker. Two jobs:
 *   1. Drain the notification outbox to Discord.
 *   2. Run the calendar jobs (on-this-day, weekly/monthly reflection, reminders).
 *
 * With Discord unconfigured it still runs: outbox rows are marked `skipped` with
 * a reason, so Settings shows the truth instead of a fake "sent" state.
 */

const TICK_MS = 60_000;

async function postToDiscord(channelId: string, message: DiscordMessage): Promise<string> {
  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bot ${config.discord.token}`,
    },
    body: JSON.stringify({
      content: message.content,
      ...(message.embeds ? { embeds: message.embeds } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    // Never log the body: it contains diary text.
    throw new Error(`Discord HTTP ${response.status}`);
  }
  const json = (await response.json()) as { id?: string };
  return json.id ?? "unknown";
}

async function drainOutbox(limit = 20): Promise<{ sent: number; failed: number; skipped: number }> {
  const pending = await pendingNotifications(limit);
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of pending) {
    // Operator-only delivery. A single DISCORD_NOTIFY_CHANNEL_ID in .env serves
    // the whole instance, so an invitee's excerpt would be posted to the
    // operator's own channel while /register promises per-account privacy.
    // See lib/notify.ts. Invitees still get reminders — marked skipped, visible
    // in Settings → outbox — rather than delivered to the wrong inbox.
    const channelId = discordDeliveryEnabled(row.user)
      ? row.user.discord
        ? config.discord.notifyChannelId
        : ""
      : "";
    if (!discordConfigured() || !channelId) {
      await markNotificationSkipped(
        row.id,
        !discordDeliveryEnabled(row.user)
          ? "Discord delivery is limited to the instance operator."
          : discordConfigured()
            ? "No notification channel configured (DISCORD_NOTIFY_CHANNEL_ID)."
            : "Discord bot is not configured.",
      );
      skipped += 1;
      continue;
    }

    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(row.payload) as Record<string, unknown>;
    } catch {
      payload = {};
    }
    payload.entryId = payload.entryId ?? row.entryId;

    try {
      const message = renderNotification(row.kind, payload);
      const id = await postToDiscord(channelId, message);
      await markNotificationSent(row.id, id);
      sent += 1;
    } catch (error) {
      await markNotificationFailed(row.id, error instanceof Error ? error.message : "unknown");
      failed += 1;
    }
  }

  return { sent, failed, skipped };
}

/**
 * Calendar jobs. Each one is idempotent for the day: a marker row in AiInsight
 * with kind "job" prevents duplicate sends if the worker restarts.
 */
async function alreadyRan(userId: string, jobKey: string): Promise<boolean> {
  const marker = await prisma.aiInsight.findFirst({
    where: { userId, subjectType: "job", subjectId: jobKey, kind: "summary" },
    select: { id: true },
  });
  return Boolean(marker);
}

async function markRan(userId: string, jobKey: string): Promise<void> {
  await prisma.aiInsight.create({
    data: { userId, subjectType: "job", subjectId: jobKey, kind: "summary", model: "none", content: "{}" },
  });
}

async function runCalendarJobs(): Promise<void> {
  const users = await prisma.user.findMany({ include: { settings: true, discord: true } });

  for (const user of users) {
    const timezone = user.settings?.timezone ?? user.timezone;
    const now = new Date();
    const today = dayKey(now, timezone);
    const hour = localHour(now, timezone);
    const settings = user.settings;

    // 1. Reminders that are due.
    const dueReminders = await prisma.reminder.findMany({
      where: { userId: user.id, status: "pending", remindAt: { lte: now } },
      take: 10,
    });
    // Notifications are operator-only (see lib/notify.ts). Invitees' reminders
    // are still consumed — answered and rescheduled — just not delivered, so
    // nothing is left pending forever.
    const deliver = discordDeliveryEnabled(user);
    for (const reminder of dueReminders) {
      await prisma.$transaction([
        prisma.reminder.update({ where: { id: reminder.id }, data: { status: "sent", sentAt: now } }),
        ...(deliver
          ? [
              prisma.notificationOutbox.create({
                data: {
                  userId: user.id,
                  kind: "reminder.due",
                  payload: JSON.stringify({ text: reminder.text }),
                  scheduledFor: now,
                },
              }),
            ]
          : []),
      ]);
      // Repeat reminders queue their next occurrence instead of vanishing.
      if (reminder.recurrence !== "none") {
        const next = new Date(reminder.remindAt);
        if (reminder.recurrence === "daily") next.setDate(next.getDate() + 1);
        if (reminder.recurrence === "weekly") next.setDate(next.getDate() + 7);
        if (reminder.recurrence === "monthly") next.setMonth(next.getMonth() + 1);
        await prisma.reminder.create({
          data: {
            userId: user.id,
            text: reminder.text,
            remindAt: next,
            recurrence: reminder.recurrence,
          },
        });
      }
    }

    // 2. On this day — evening, once per day.
    if (settings?.onThisDay !== false && hour >= 19) {
      const key = `on_this_day:${today}`;
      if (!(await alreadyRan(user.id, key))) {
        const monthDay = today.slice(5);
        const memories = await prisma.entry.findMany({
          where: {
            userId: user.id,
            deletedAt: null,
            day: { endsWith: `-${monthDay}` },
            NOT: { day: today },
          },
          orderBy: { day: "desc" },
          take: 1,
        });
        // Silence is correct when nothing exists — never fabricate a memory.
        // The `deliver` gate keeps an invitee's diary text from being queued at
        // all (see lib/notify.ts).
        if (deliver && memories.length) {
          const memory = memories[0];
          await prisma.notificationOutbox.create({
            data: {
              userId: user.id,
              kind: "memory.on_this_day",
              entryId: memory.id,
              payload: JSON.stringify({
                day: memory.day,
                title: titleOrExcerpt(memory.title, memory.content),
                preview: excerpt(memory.content, 900),
                relative: relativeDay(memory.day, today),
              }),
            },
          });
        }
        await markRan(user.id, key);
      }
    }

    // 3. Weekly reflection — Friday from 17:00 local.
    if (settings?.weeklyReflection !== false && now.getDay() === 5 && hour >= 17) {
      const weekKey = `weekly:${today}`;
      if (!(await alreadyRan(user.id, weekKey))) {
        const facts = await reflectionFacts(user.id, today, "week");
        if (deliver && facts.entryCount > 0) {
          await prisma.notificationOutbox.create({
            data: {
              userId: user.id,
              kind: "reflection.weekly",
              payload: JSON.stringify({
                entryCount: facts.entryCount,
                words: facts.words,
                tags: facts.tags.slice(0, 6).map((t) => t.slug),
                from: facts.from,
                to: facts.to,
              }),
            },
          });
        }
        await markRan(user.id, weekKey);
      }
    }

    // 4. Monthly reflection — 1st of the month, from 08:00.
    if (hour >= 8 && now.getDate() === 1) {
      const monthKey = `monthly:${today.slice(0, 7)}`;
      if (!(await alreadyRan(user.id, monthKey))) {
        const previousDay = addDays(today, -1);
        const facts = await reflectionFacts(user.id, previousDay, "month");
        if (deliver && facts.entryCount > 0) {
          await prisma.notificationOutbox.create({
            data: {
              userId: user.id,
              kind: "reflection.monthly",
              payload: JSON.stringify({
                entryCount: facts.entryCount,
                words: facts.words,
                tags: facts.tags.slice(0, 6).map((t) => t.slug),
                month: previousDay.slice(0, 7),
              }),
            },
          });
        }
        await markRan(user.id, monthKey);
      }
    }

    // 5. Unresolved thoughts that have gone quiet for 30+ days.
    if (hour >= 19) {
      const stale = await prisma.unresolvedThought.findMany({
        where: {
          userId: user.id,
          status: "open",
          updatedAt: { lt: new Date(Date.now() - 30 * 86_400_000) },
        },
        take: 1,
      });
      for (const thought of stale) {
        const key = `thought_followup:${thought.id}:${today.slice(0, 7)}`;
        if (await alreadyRan(user.id, key)) continue;
        // Only queue when delivery is allowed — hold the bookkeeping either way,
        // so this does not re-evaluate the same thought every evening.
        if (deliver) {
          await prisma.notificationOutbox.create({
            data: {
              userId: user.id,
              kind: "thought.followup",
              payload: JSON.stringify({
                question: thought.question,
                lastMention: shortDate(thought.updatedAt),
              }),
            },
          });
        }
        await markRan(user.id, key);
      }
    }
  }
}

async function tick(): Promise<void> {
  const outbox = await drainOutbox();
  await runCalendarJobs();
  if (outbox.sent || outbox.failed) {
    console.log(
      `[worker] ${new Date().toISOString()} sent=${outbox.sent} failed=${outbox.failed} skipped=${outbox.skipped}`,
    );
  }
}

async function main() {
  const once = process.argv.includes("--once");
  console.log(
    `[worker] starting (discord ${discordConfigured() ? "configured" : "NOT configured"}, ${config.timezone})`,
  );

  if (once) {
    await tick();
    await prisma.$disconnect();
    console.log("[worker] single pass complete");
    return;
  }

  await tick();
  setInterval(() => {
    tick().catch((error) =>
      console.error("[worker] tick failed:", error instanceof Error ? error.message : error),
    );
  }, TICK_MS);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
