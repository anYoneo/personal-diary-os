import { apiHandler, json, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { threadSchema } from "@/lib/validation";
import { slugifyTag } from "@/lib/services/entries";
import { conflict } from "@/lib/errors";

export const GET = apiHandler("threads.list", async () => {
  const user = await requireUser();
  const threads = await prisma.thread.findMany({
    where: { userId: user.id },
    include: { _count: { select: { entries: true, goals: true } } },
    orderBy: { name: "asc" },
  });
  return json({
    threads: threads.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      kind: t.kind,
      status: t.status,
      description: t.description,
      entryCount: t._count.entries,
      goalCount: t._count.goals,
    })),
  });
});

export const POST = apiHandler("threads.create", async (request: Request) => {
  const user = await requireUser();
  const input = await parseBody(request, threadSchema);
  const slug = slugifyTag(input.name);

  const existing = await prisma.thread.findUnique({
    where: { userId_slug: { userId: user.id, slug } },
  });
  if (existing) throw conflict("A thread with that name already exists.");

  const thread = await prisma.thread.create({
    data: {
      userId: user.id,
      name: input.name,
      slug,
      kind: input.kind,
      status: input.status,
      description: input.description ?? null,
      color: input.color ?? null,
    },
  });
  return json({ id: thread.id, slug: thread.slug, name: thread.name }, { status: 201 });
});
