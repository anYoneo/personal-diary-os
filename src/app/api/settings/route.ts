import { apiHandler, json, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { settingsSchema } from "@/lib/validation";
import { aiStatus } from "@/lib/services/ai";
import { recomputeDays } from "@/lib/services/entries";
import { discordConfigured } from "@/lib/config";

export const GET = apiHandler("settings.get", async () => {
  const user = await requireUser();
  const [settings, link, outbox] = await Promise.all([
    prisma.userSettings.findUnique({ where: { userId: user.id } }),
    prisma.discordLink.findUnique({ where: { userId: user.id } }),
    prisma.notificationOutbox.groupBy({
      by: ["status"],
      where: { userId: user.id },
      _count: { _all: true },
    }),
  ]);

  return json({
    email: user.email,
    timezone: settings?.timezone ?? user.timezone,
    preferences: {
      notifyOnEntry: settings?.notifyOnEntry ?? true,
      notifyOnReminder: settings?.notifyOnReminder ?? true,
      weeklyReflection: settings?.weeklyReflection ?? true,
      onThisDay: settings?.onThisDay ?? true,
      reflectionPrompt: settings?.reflectionPrompt ?? true,
      quietHoursStart: settings?.quietHoursStart ?? null,
      quietHoursEnd: settings?.quietHoursEnd ?? null,
    },
    discord: {
      botConfigured: discordConfigured(),
      linked: Boolean(link),
      username: link?.username ?? null,
    },
    ai: aiStatus(),
    notifications: outbox.map((row) => ({ status: row.status, count: row._count._all })),
  });
});

export const PATCH = apiHandler("settings.update", async (request: Request) => {
  const user = await requireUser();
  const input = await parseBody(request, settingsSchema);

  const settings = await prisma.userSettings.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      timezone: input.timezone ?? user.timezone,
      quietHoursStart: input.quietHoursStart ?? null,
      quietHoursEnd: input.quietHoursEnd ?? null,
    },
    update: {
      ...(input.timezone ? { timezone: input.timezone } : {}),
      ...(input.notifyOnEntry !== undefined ? { notifyOnEntry: input.notifyOnEntry } : {}),
      ...(input.notifyOnReminder !== undefined ? { notifyOnReminder: input.notifyOnReminder } : {}),
      ...(input.weeklyReflection !== undefined ? { weeklyReflection: input.weeklyReflection } : {}),
      ...(input.onThisDay !== undefined ? { onThisDay: input.onThisDay } : {}),
      // Accept both names so older clients keep working.
      ...(input.reflectionPrompt !== undefined
        ? { reflectionPrompt: input.reflectionPrompt }
        : input.reflectionPromptEnabled !== undefined
          ? { reflectionPrompt: input.reflectionPromptEnabled }
          : {}),
      ...(input.quietHoursStart !== undefined ? { quietHoursStart: input.quietHoursStart } : {}),
      ...(input.quietHoursEnd !== undefined ? { quietHoursEnd: input.quietHoursEnd } : {}),
    },
  });

  // Recompute day buckets if the timezone moved — otherwise past entries would
  // silently belong to the wrong day from now on.
  if (input.timezone && input.timezone !== user.timezone) {
    await prisma.user.update({ where: { id: user.id }, data: { timezone: input.timezone } });
    await recomputeDays(user.id, input.timezone);
  }

  // Echo back the effective settings so callers never have to guess.
  return json({
    settings: {
      timezone: settings.timezone,
      notifyOnEntry: settings.notifyOnEntry,
      notifyOnReminder: settings.notifyOnReminder,
      weeklyReflection: settings.weeklyReflection,
      onThisDay: settings.onThisDay,
      reflectionPrompt: settings.reflectionPrompt,
      quietHoursStart: settings.quietHoursStart,
      quietHoursEnd: settings.quietHoursEnd,
    },
  });
});
