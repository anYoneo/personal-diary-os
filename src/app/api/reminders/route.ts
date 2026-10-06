import { apiHandler, json, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { reminderSchema } from "@/lib/validation";
import { enqueue } from "@/lib/services/notifications";
import { audit } from "@/lib/audit";
import { notFound } from "@/lib/errors";

export const GET = apiHandler("reminders.list", async () => {
  const user = await requireUser();
  const reminders = await prisma.reminder.findMany({
    where: { userId: user.id, status: { not: "cancelled" } },
    orderBy: { remindAt: "asc" },
    take: 50,
  });
  return json({
    reminders: reminders.map((r) => ({
      id: r.id,
      text: r.text,
      remindAt: r.remindAt.toISOString(),
      recurrence: r.recurrence,
      status: r.status,
      sentAt: r.sentAt?.toISOString() ?? null,
    })),
  });
});

export const POST = apiHandler("reminders.create", async (request: Request) => {
  const user = await requireUser();
  const input = await parseBody(request, reminderSchema);

  const reminder = await prisma.reminder.create({
    data: {
      userId: user.id,
      text: input.text,
      remindAt: input.remindAt,
      recurrence: input.recurrence,
    },
  });

  // The worker queues it; if Discord isn't configured it stays pending and the
  // UI shows it as "waiting for Discord" rather than pretending it was sent.
  await enqueue(user.id, "reminder.due", {
    text: reminder.text,
    remindAt: reminder.remindAt.toISOString(),
  });

  await audit(user.id, "reminder.create", "reminder", reminder.id, { when: reminder.remindAt.toISOString() });
  return json({ id: reminder.id, remindAt: reminder.remindAt.toISOString() }, { status: 201 });
});

export const DELETE = apiHandler("reminders.delete", async (request: Request) => {
  const user = await requireUser();
  const id = new URL(request.url).searchParams.get("id");
  if (!id) throw notFound("Reminder not found");
  const reminder = await prisma.reminder.findFirst({ where: { id, userId: user.id } });
  if (!reminder) throw notFound("Reminder not found");
  await prisma.reminder.update({ where: { id, userId: user.id }, data: { status: "cancelled" } });
  return json({ cancelled: true });
});
