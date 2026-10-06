import { apiHandler, json, parseBody, parseQuery } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { createEntry, listEntries, entryPreview } from "@/lib/services/entries";
import { entryCreateSchema, entryQuerySchema } from "@/lib/validation";

export const GET = apiHandler("entries.list", async (request: Request) => {
  const user = await requireUser();
  const query = parseQuery(request, entryQuerySchema);
  const { items, nextCursor, total } = await listEntries(user.id, query);
  return json({
    entries: items.map(entryPreview),
    nextCursor,
    total,
  });
});

export const POST = apiHandler("entries.create", async (request: Request) => {
  const user = await requireUser();
  const input = await parseBody(request, entryCreateSchema);
  const entry = await createEntry(user.id, user.timezone, input);
  return json(
    {
      id: entry.id,
      day: entry.day,
      wordCount: entry.wordCount,
      version: entry.version,
      title: entry.title,
    },
    { status: 201 },
  );
});
