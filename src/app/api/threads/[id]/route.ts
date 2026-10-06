import { apiHandler, json, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { threadSchema } from "@/lib/validation";
import { notFound } from "@/lib/errors";

export const PATCH = apiHandler("threads.update", async (request: Request, ctx: RouteContext<"/api/threads/[id]">) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const input = await parseBody(request, threadSchema.partial());

  const thread = await prisma.thread.findFirst({ where: { id, userId: user.id } });
  if (!thread) throw notFound("Thread not found");

  const updated = await prisma.thread.update({
    where: { id, userId: user.id },
    data: {
      ...(input.name ? { name: input.name } : {}),
      ...(input.kind ? { kind: input.kind } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.description !== undefined ? { description: input.description ?? null } : {}),
      ...(input.color !== undefined ? { color: input.color ?? null } : {}),
    },
  });
  return json({ id: updated.id, name: updated.name, status: updated.status });
});

/**
 * Deleting a thread never deletes writing — the join rows go, entries stay.
 */
export const DELETE = apiHandler("threads.delete", async (_request: Request, ctx: RouteContext<"/api/threads/[id]">) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const thread = await prisma.thread.findFirst({ where: { id, userId: user.id } });
  if (!thread) throw notFound("Thread not found");
  await prisma.$transaction([
    prisma.entryThread.deleteMany({ where: { threadId: id } }),
    prisma.goal.updateMany({ where: { threadId: id, userId: user.id }, data: { threadId: null } }),
    prisma.thread.delete({ where: { id } }),
  ]);
  return json({ deleted: true });
});
