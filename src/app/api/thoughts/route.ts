import { apiHandler, json, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { thoughtSchema } from "@/lib/validation";
import { audit } from "@/lib/audit";
import { notFound } from "@/lib/errors";

export const GET = apiHandler("thoughts.list", async (request: Request) => {
  const user = await requireUser();
  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "open";

  const thoughts = await prisma.unresolvedThought.findMany({
    where: { userId: user.id, ...(status === "all" ? {} : { status }) },
    include: {
      firstEntry: { select: { id: true, day: true } },
      lastEntry: { select: { id: true, day: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  return json({
    thoughts: thoughts.map((t) => ({
      id: t.id,
      question: t.question,
      note: t.note,
      status: t.status,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
      resolvedAt: t.resolvedAt?.toISOString() ?? null,
      resolvedNote: t.resolvedNote,
      firstMention: t.firstEntry ? { id: t.firstEntry.id, day: t.firstEntry.day } : null,
      lastMention: t.lastEntry ? { id: t.lastEntry.id, day: t.lastEntry.day } : null,
      /** Days since it was raised — the number that makes this useful. */
      ageDays: Math.floor((Date.now() - t.createdAt.getTime()) / 86_400_000),
    })),
  });
});

export const POST = apiHandler("thoughts.create", async (request: Request) => {
  const user = await requireUser();
  const input = await parseBody(request, thoughtSchema);

  const thought = await prisma.unresolvedThought.create({
    data: {
      userId: user.id,
      question: input.question,
      note: input.note ?? null,
      threadId: input.threadId ?? null,
    },
  });
  return json({ id: thought.id }, { status: 201 });
});

export const PATCH = apiHandler("thoughts.update", async (request: Request) => {
  const user = await requireUser();
  const body = (await request.json().catch(() => ({}))) as {
    id?: string;
    status?: "open" | "resolved" | "dropped";
    question?: string;
    note?: string | null;
    resolvedNote?: string | null;
    linkEntryId?: string | null;
  };

  if (!body.id) throw notFound("Thought not found");
  const thought = await prisma.unresolvedThought.findFirst({
    where: { id: body.id, userId: user.id },
  });
  if (!thought) throw notFound("Thought not found");

  const status = body.status;
  const updated = await prisma.unresolvedThought.update({
    where: { id: thought.id, userId: user.id },
    data: {
      ...(body.question ? { question: body.question.trim().slice(0, 400) } : {}),
      ...(body.note !== undefined ? { note: body.note?.slice(0, 2000) ?? null } : {}),
      ...(status ? { status } : {}),
      ...(status === "resolved" ? { resolvedAt: new Date(), resolvedNote: body.resolvedNote ?? null } : {}),
      ...(status === "open" ? { resolvedAt: null, resolvedNote: null } : {}),
      // Linking an entry records when it was raised or last touched.
      ...(body.linkEntryId
        ? thought.firstEntryId
          ? { lastEntryId: body.linkEntryId }
          : { firstEntryId: body.linkEntryId, lastEntryId: body.linkEntryId }
        : {}),
    },
  });

  await audit(user.id, "thought.update", "unresolved_thought", thought.id, { status: updated.status });
  return json({ id: updated.id, status: updated.status });
});

export const DELETE = apiHandler("thoughts.delete", async (request: Request) => {
  const user = await requireUser();
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) throw notFound("Thought not found");

  const thought = await prisma.unresolvedThought.findFirst({ where: { id, userId: user.id } });
  if (!thought) throw notFound("Thought not found");

  await prisma.unresolvedThought.delete({ where: { id, userId: user.id } });
  await audit(user.id, "thought.delete", "unresolved_thought", id);
  return json({ deleted: true });
});
