import { apiHandler, json, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { goalSchema } from "@/lib/validation";
import { audit } from "@/lib/audit";
import { notFound } from "@/lib/errors";

export const PATCH = apiHandler("goals.update", async (request: Request, ctx: RouteContext<"/api/goals/[id]">) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as {
    title?: string;
    detail?: string | null;
    status?: "open" | "done" | "dropped";
    threadId?: string | null;
    targetDate?: string | null;
  };

  const goal = await prisma.goal.findFirst({ where: { id, userId: user.id } });
  if (!goal) throw notFound("Goal not found");

  const status = body.status;
  const updated = await prisma.goal.update({
    where: { id, userId: user.id },
    data: {
      ...(body.title ? { title: body.title.trim().slice(0, 200) } : {}),
      ...(body.detail !== undefined ? { detail: body.detail?.slice(0, 2000) ?? null } : {}),
      ...(status ? { status } : {}),
      ...(status === "done" ? { completedAt: new Date() } : {}),
      ...(status === "open" ? { completedAt: null } : {}),
      ...(body.threadId !== undefined ? { threadId: body.threadId } : {}),
      ...(body.targetDate !== undefined
        ? { targetDate: body.targetDate ? new Date(body.targetDate) : null }
        : {}),
    },
  });

  await audit(user.id, "goal.update", "goal", id, { status: updated.status });
  return json({ id: updated.id, status: updated.status });
});

export const DELETE = apiHandler("goals.delete", async (_request: Request, ctx: RouteContext<"/api/goals/[id]">) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const goal = await prisma.goal.findFirst({ where: { id, userId: user.id } });
  if (!goal) throw notFound("Goal not found");
  await prisma.goal.delete({ where: { id, userId: user.id } });
  await audit(user.id, "goal.delete", "goal", id);
  return json({ deleted: true });
});

export { goalSchema };
