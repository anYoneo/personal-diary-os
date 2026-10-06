import { apiHandler, json } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { getEntry } from "@/lib/services/entries";
import { aiStatus, runAi, saveInsight, insightsFor, type AiTask } from "@/lib/services/ai";
import { reflectionFacts } from "@/lib/services/insights";
import { dayKey } from "@/lib/day";
import { badRequest } from "@/lib/errors";
import { prisma } from "@/lib/db";

const TASKS: AiTask[] = ["summary", "tags", "entities", "reflection", "similar", "pattern", "contradiction"];

/**
 * AI endpoints. When no provider is configured they return 200 with
 * `available:false` and an explanatory reason, so the UI can state honestly that
 * the feature is not configured instead of showing a broken or fake result.
 */
export const GET = apiHandler("ai.status", async () => {
  const user = await requireUser();
  const stored = await insightsFor(user.id, "entry");
  return json({
    ...aiStatus(),
    recent: stored.map((i) => ({
      id: i.id,
      kind: i.kind,
      subjectType: i.subjectType,
      subjectId: i.subjectId,
      createdAt: i.createdAt.toISOString(),
    })),
  });
});

export const POST = apiHandler("ai.run", async (request: Request) => {
  const user = await requireUser();
  const body = (await request.json().catch(() => ({}))) as {
    task?: string;
    entryId?: string;
    question?: string;
    period?: "week" | "month";
  };

  const task = (body.task ?? "summary") as AiTask;
  if (!TASKS.includes(task)) throw badRequest(`Unknown task. Use one of: ${TASKS.join(", ")}`);

  const today = dayKey(new Date(), user.timezone);

  let entries: { id: string; day: string; text: string }[] = [];
  let subjectType = "entry";
  let subjectId: string | null = null;

  if (task === "reflection") {
    subjectType = "reflection";
    const facts = await reflectionFacts(user.id, today, body.period ?? "week");
    const rows = await prisma.entry.findMany({
      where: { userId: user.id, deletedAt: null, id: { in: facts.citedEntries.map((c) => c.id) } },
      select: { id: true, day: true, content: true, title: true },
      orderBy: { day: "asc" },
    });
    entries = rows.map((r) => ({ id: r.id, day: r.day, text: `${r.title ?? ""}\n${r.content}`.trim() }));
  } else if (body.entryId) {
    const entry = await getEntry(user.id, body.entryId);
    subjectId = entry.id;
    entries = [{ id: entry.id, day: entry.day, text: entry.content }];
  } else {
    // No specific entry: use the most recent writing as context.
    const rows = await prisma.entry.findMany({
      where: { userId: user.id, deletedAt: null },
      orderBy: { occurredAt: "desc" },
      take: 10,
      select: { id: true, day: true, content: true, title: true },
    });
    entries = rows.map((r) => ({ id: r.id, day: r.day, text: `${r.title ?? ""}\n${r.content}`.trim() }));
  }

  const result = await runAi({ task, entries, question: body.question });
  if (!result.available) return json({ available: false, reason: result.reason });

  await saveInsight({
    userId: user.id,
    subjectType,
    subjectId,
    kind: task,
    model: result.value.model,
    content: { text: result.value.text },
    entryId: subjectId,
  });

  return json({
    available: true,
    task,
    text: result.value.text,
    model: result.value.model,
    /** Always shown next to AI output: which entries it was allowed to read. */
    sources: result.value.sourceEntryIds,
  });
});
