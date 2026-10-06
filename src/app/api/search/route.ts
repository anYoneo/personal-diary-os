import { apiHandler, json, parseQuery } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { searchEntries, mentionStats } from "@/lib/services/memory";
import { entryQuerySchema } from "@/lib/validation";

export const GET = apiHandler("search", async (request: Request) => {
  const user = await requireUser();
  const query = parseQuery(request, entryQuerySchema);
  const url = new URL(request.url);

  // "first mention" / "last mention" views reuse the same endpoint.
  if (url.searchParams.get("mode") === "mentions" && query.q) {
    const stats = await mentionStats(user.id, query.q);
    return json({ mode: "mentions", stats });
  }

  const result = await searchEntries(user.id, {
    q: query.q ?? "",
    from: query.from,
    to: query.to,
    type: query.type,
    mood: query.mood,
    tag: query.tag,
    thread: query.thread,
    limit: query.limit,
  });

  return json(result);
});
