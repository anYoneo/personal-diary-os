import { apiHandler, json, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import {
  getEntry,
  purgeEntry,
  softDeleteEntry,
  updateEntry,
  restoreEntry,
} from "@/lib/services/entries";
import { entryUpdateSchema } from "@/lib/validation";
import { relatedMemories } from "@/lib/services/memory-graph";

export const GET = apiHandler("entries.get", async (_request: Request, ctx: RouteContext<"/api/entries/[id]">) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const entry = await getEntry(user.id, id);
  return json({
    id: entry.id,
    title: entry.title,
    content: entry.content,
    entryType: entry.entryType,
    mood: entry.mood,
    occurredAt: entry.occurredAt.toISOString(),
    day: entry.day,
    location: entry.location,
    isImportant: entry.isImportant,
    source: entry.source,
    wordCount: entry.wordCount,
    version: entry.version,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
    tags: entry.tags.map((t) => t.tag.slug),
    threads: entry.threads.map((t) => ({ id: t.thread.id, name: t.thread.name })),
  });
});

export const PATCH = apiHandler("entries.update", async (request: Request, ctx: RouteContext<"/api/entries/[id]">) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const input = await parseBody(request, entryUpdateSchema);

  const entry = await updateEntry(user.id, id, {
    timezone: user.timezone,
    ...(input.title !== undefined ? { title: input.title?.trim() || null } : {}),
    ...(input.content !== undefined ? { content: input.content } : {}),
    ...(input.entryType !== undefined ? { entryType: input.entryType } : {}),
    ...(input.mood !== undefined ? { mood: input.mood ?? null } : {}),
    ...(input.occurredAt !== undefined && input.occurredAt ? { occurredAt: input.occurredAt } : {}),
    ...(input.location !== undefined ? { location: input.location ?? null } : {}),
    ...(input.isImportant !== undefined ? { isImportant: input.isImportant } : {}),
    ...(input.tags !== undefined ? { tags: input.tags } : {}),
    ...(input.threadIds !== undefined ? { threadIds: input.threadIds } : {}),
    ...(input.expectedVersion !== undefined ? { expectedVersion: input.expectedVersion } : {}),
  });

  return json({
    id: entry.id,
    day: entry.day,
    wordCount: entry.wordCount,
    version: entry.version,
    updatedAt: entry.updatedAt.toISOString(),
    tags: entry.tags.map((t) => t.tag.slug),
  });
});

/** Soft delete by default — a mis-tap must never destroy writing. */
export const DELETE = apiHandler("entries.delete", async (request: Request, ctx: RouteContext<"/api/entries/[id]">) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const url = new URL(request.url);
  const hard = url.searchParams.get("hard") === "true";

  if (hard) {
    await purgeEntry(user.id, id);
    return json({ purged: true });
  }
  await softDeleteEntry(user.id, id);
  return json({ deleted: true });
});

export const POST = apiHandler("entries.restore", async (request: Request, ctx: RouteContext<"/api/entries/[id]">) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const url = new URL(request.url);

  if (url.searchParams.get("action") === "related") {
    const entry = await getEntry(user.id, id);
    const related = await relatedMemories(user.id, {
      id: entry.id,
      content: entry.content,
      day: entry.day,
      tags: entry.tags,
      threads: entry.threads.map((t) => ({ threadId: t.threadId })),
    });
    return json({
      related: related.map((r) => ({
        id: r.entry.id,
        day: r.entry.day,
        title: r.entry.title,
        excerpt: r.entry.content.slice(0, 200),
        reason: r.reason,
        score: r.score,
      })),
    });
  }

  await restoreEntry(user.id, id);
  return json({ restored: true });
});
