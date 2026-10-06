import { apiHandler, json, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { goalSchema } from "@/lib/validation";
import { audit } from "@/lib/audit";
import { notFound } from "@/lib/errors";

export const GET = apiHandler("goals.list", async () => {
  const user = await requireUser();
  const goals = await prisma.goal.findMany({
    where: { userId: user.id },
    include: { thread: { select: { name: true, slug: true } } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
  return json({
    goals: goals.map((g) => ({
      id: g.id,
      title: g.title,
      detail: g.detail,
      status: g.status,
      thread: g.thread?.name ?? null,
      threadSlug: g.thread?.slug ?? null,
      targetDate: g.targetDate?.toISOString() ?? null,
      completedAt: g.completedAt?.toISOString() ?? null,
      createdAt: g.createdAt.toISOString(),
    })),
  });
});

export const POST = apiHandler("goals.create", async (request: Request) => {
  const user = await requireUser();
  const input = await parseBody(request, goalSchema);

  if (input.threadId) {
    const thread = await prisma.thread.findFirst({
      where: { id: input.threadId, userId: user.id },
      select: { id: true },
    });
    if (!thread) throw notFound("Thread not found");
  }

  const goal = await prisma.goal.create({
    data: {
      userId: user.id,
      title: input.title,
      detail: input.detail ?? null,
      threadId: input.threadId ?? null,
      targetDate: input.targetDate ?? null,
    },
  });
  return json({ id: goal.id, title: goal.title }, { status: 201 });
});
