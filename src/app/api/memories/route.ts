import { apiHandler, json } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { dayKey } from "@/lib/day";
import {
  forwardMemory,
  ghostThreads,
  lifeThreads,
  memoryDigest,
  perspectiveShifts,
  randomMemory,
  relatedMemories,
} from "@/lib/services/memory-graph";
import { getEntry } from "@/lib/services/entries";

/**
 * Every mode returns either real stored entries or an explicit empty result.
 * Nothing here synthesises a "memory" that isn't in the database.
 */
export const GET = apiHandler("memories", async (request: Request) => {
  const user = await requireUser();
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") ?? "digest";
  const today = dayKey(new Date(), user.timezone);

  switch (mode) {
    case "random":
      return json({ mode, memory: await randomMemory(user.id) });

    case "on-this-day":
      return json({ mode, memory: await forwardMemory(user.id, today) });

    case "threads":
      return json({ mode, threads: await lifeThreads(user.id) });

    case "ghosts":
      return json({ mode, ghosts: await ghostThreads(user.id, today) });

    case "shifts":
      return json({ mode, shifts: await perspectiveShifts(user.id) });

    case "related": {
      const id = url.searchParams.get("entryId");
      if (!id) return json({ mode, related: [] });
      const entry = await getEntry(user.id, id);
      const related = await relatedMemories(user.id, {
        id: entry.id,
        content: entry.content,
        day: entry.day,
        tags: entry.tags,
        threads: entry.threads.map((t) => ({ threadId: t.threadId })),
      });
      return json({
        mode,
        related: related.map((r) => ({
          id: r.entry.id,
          day: r.entry.day,
          title: r.entry.title,
          excerpt: r.entry.content.slice(0, 240),
          reason: r.reason,
          score: r.score,
        })),
      });
    }

    default:
      return json({ mode: "digest", ...(await memoryDigest(user.id, today)) });
  }
});
