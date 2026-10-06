import { apiHandler, json } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { dayKey } from "@/lib/day";
import { insights, reflectionFacts, activityHeatmap } from "@/lib/services/insights";
import { currentStreak } from "@/lib/services/entries";
import { prisma } from "@/lib/db";

export const GET = apiHandler("analytics", async (request: Request) => {
  const user = await requireUser();
  const url = new URL(request.url);
  const today = dayKey(new Date(), user.timezone);

  if (url.searchParams.get("mode") === "reflection") {
    const period = url.searchParams.get("period") === "month" ? "month" : "week";
    const facts = await reflectionFacts(user.id, today, period);
    return json({
      mode: "reflection",
      facts,
      /** AI interpretation is a separate field. Facts and interpretation never mix. */
      interpretation: null,
    });
  }

  const [report, heatmap, days] = await Promise.all([
    insights(user.id, today),
    activityHeatmap(user.id, today, 182),
    prisma.entry.groupBy({
      by: ["day"],
      where: { userId: user.id, deletedAt: null },
      _count: { _all: true },
      orderBy: { day: "desc" },
      take: 400,
    }),
  ]);

  return json({
    today,
    ...report,
    streaks: { ...report.streaks, current: currentStreak(days.map((d) => d.day), today) },
    heatmap,
  });
});
