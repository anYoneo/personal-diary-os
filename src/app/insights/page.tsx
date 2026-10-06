import { Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { dayKey, monthLabel, shortDate } from "@/lib/day";
import { insights, reflectionFacts, activityHeatmap } from "@/lib/services/insights";
import { aiStatus } from "@/lib/services/ai";
import Link from "next/link";
import { MOODS } from "@/lib/validation";
import { ReflectionPanel } from "./reflection-panel";

export const dynamic = "force-dynamic";

export default async function InsightsPage() {
  const user = await requireUser();
  const today = dayKey(new Date(), user.timezone);

  const [report, heatmap, weekFacts, monthFacts] = await Promise.all([
    insights(user.id, today),
    activityHeatmap(user.id, today, 182),
    reflectionFacts(user.id, today, "week"),
    reflectionFacts(user.id, today, "month"),
  ]);

  const ai = aiStatus();

  if (report.totals.entries === 0) {
    return (
      <Shell>
        <Header ai={ai.configured} model={ai.model} />
        <div className="panel mt-7 px-5 py-10 text-center">
          <p className="font-serif text-[16px]" style={{ color: "var(--fg-2)" }}>
            No data to read yet.
          </p>
          <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>
            Insights are counts of what you actually wrote. Write a few entries and this page fills in.
          </p>
          <Link href="/write" className="btn btn-accent mt-5">
            Write an entry
          </Link>
        </div>
      </Shell>
    );
  }

  const currentStreak = computeStreak(heatmap);
  const weeks = groupHeatmap(heatmap);

  return (
    <Shell>
      <Header ai={ai.configured} model={ai.model} />

      <section className="rise mt-7 grid grid-cols-2 gap-px overflow-hidden rounded-[12px] border md:grid-cols-4" style={{ borderColor: "var(--line-soft)", animationDelay: "60ms" }}>
        <Stat label="Entries" value={report.totals.entries.toLocaleString("en-US")} />
        <Stat label="Words" value={report.totals.words.toLocaleString("en-US")} />
        <Stat label="Days written" value={String(report.totals.days)} />
        <Stat
          label="Current streak"
          value={`${currentStreak} ${currentStreak === 1 ? "day" : "days"}`}
          hint={`longest ${report.streaks.longest}`}
        />
      </section>

      <section className="mt-8">
        <h2 className="label mb-3">Writing activity · last 26 weeks</h2>
        <div className="panel overflow-x-auto px-4 py-4">
          <div className="flex gap-[3px]">
            {weeks.map((week, i) => (
              <div key={i} className="flex flex-col gap-[3px]">
                {week.map((cell) => (
                  <span
                    key={cell.day}
                    className="streak-cell"
                    data-level={cell.level}
                    title={`${cell.day} — ${cell.count} ${cell.count === 1 ? "entry" : "entries"}, ${cell.words} words`}
                  />
                ))}
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="mono text-[10px]" style={{ color: "var(--muted-2)" }}>
              less
            </span>
            {[0, 1, 2, 3, 4].map((level) => (
              <span key={level} className="streak-cell" data-level={level} />
            ))}
            <span className="mono text-[10px]" style={{ color: "var(--muted-2)" }}>
              more
            </span>
            <span className="mono ml-auto text-[10px]" style={{ color: "var(--muted-2)" }}>
              {report.cadence.activeDays30} of the last 30 days
            </span>
          </div>
        </div>
      </section>

      <section className="mt-8 grid gap-4 md:grid-cols-2">
        <Panel title="Cadence">
          <Row label="This week" value={`${report.cadence.thisWeek} entries`} delta={report.cadence.thisWeek - report.cadence.lastWeek} />
          <Row label="This month" value={`${report.cadence.thisMonth} entries`} delta={report.cadence.thisMonth - report.cadence.lastMonth} />
          <Row label="Average length" value={`${report.totals.avgWords} words`} />
          {report.totals.longestEntry ? (
            <Row
              label="Longest entry"
              value={
                <Link href={`/entry/${report.totals.longestEntry.id}`} className="underline">
                  {report.totals.longestEntry.words} words on {shortDate(report.totals.longestEntry.day)}
                </Link>
              }
            />
          ) : null}
          {report.cadence.silenceDays ? (
            <p className="mt-3 text-[12px]" style={{ color: "var(--accent)" }}>
              Nothing written since {shortDate(report.cadence.silenceDays.since)} — {report.cadence.silenceDays.days} days.
            </p>
          ) : null}
        </Panel>

        <Panel title="When you write">
          <div className="flex items-end gap-[2px]" style={{ height: 74 }}>
            {report.byHour.map((bucket) => (
              <span
                key={bucket.hour}
                title={`${String(bucket.hour).padStart(2, "0")}:00 — ${bucket.count}`}
                style={{
                  flex: 1,
                  height: `${Math.max(3, (bucket.count / Math.max(1, peak(report.byHour))) * 100)}%`,
                  background: bucket.count ? "var(--accent)" : "var(--line)",
                  opacity: bucket.count ? 0.85 : 0.4,
                  borderRadius: 2,
                }}
              />
            ))}
          </div>
          <div className="mono mt-2 flex justify-between text-[10px]" style={{ color: "var(--muted-2)" }}>
            <span>00</span>
            <span>06</span>
            <span>12</span>
            <span>18</span>
            <span>23</span>
          </div>
          <p className="mt-2 text-[12px]" style={{ color: "var(--muted)" }}>
            {describePeak(report.byHour)}
          </p>
        </Panel>

        <Panel title="Mood distribution">
          {report.moodCounts.length ? (
            <ul className="space-y-2">
              {report.moodCounts.map((row) => {
                const meta = MOODS.find((m) => m.key === row.mood);
                const pct = Math.round((row.count / report.totals.entries) * 100);
                return (
                  <li key={row.mood} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-[12.5px]" style={{ color: "var(--fg-2)" }}>
                      {meta?.emoji} {meta?.label ?? row.mood}
                    </span>
                    <span className="h-[6px] flex-1 overflow-hidden rounded-full" style={{ background: "var(--line-soft)" }}>
                      <span
                        className="block h-full rounded-full"
                        style={{ width: `${Math.max(pct, 2)}%`, background: "var(--accent)", opacity: 0.8 }}
                      />
                    </span>
                    <span className="mono w-14 shrink-0 text-right text-[10px]" style={{ color: "var(--muted-2)" }}>
                      {row.count} · {pct}%
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-[12.5px]" style={{ color: "var(--muted-2)" }}>
              No moods recorded. Mood is optional and never required to save.
            </p>
          )}
        </Panel>

        <Panel title="Entry types">
          <ul className="space-y-2">
            {report.types.map((row) => {
              const pct = Math.round((row.count / report.totals.entries) * 100);
              return (
                <li key={row.entryType} className="flex items-center gap-3">
                  <span className="mono w-24 shrink-0 text-[11.5px]" style={{ color: "var(--fg-2)" }}>
                    {row.entryType}
                  </span>
                  <span className="h-[6px] flex-1 overflow-hidden rounded-full" style={{ background: "var(--line-soft)" }}>
                    <span
                      className="block h-full rounded-full"
                      style={{ width: `${Math.max(pct, 2)}%`, background: "var(--info)", opacity: 0.65 }}
                    />
                  </span>
                  <span className="mono w-10 shrink-0 text-right text-[10px]" style={{ color: "var(--muted-2)" }}>
                    {row.count}
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>
      </section>

      {report.topTags.length ? (
        <section className="mt-8">
          <h2 className="label mb-3">Subjects you return to</h2>
          <div className="flex flex-wrap gap-2">
            {report.topTags.map((tag) => (
              <Link key={tag.slug} href={`/search?tag=${tag.slug}`} className="chip">
                #{tag.name}
                <span style={{ color: "var(--muted-2)" }}>{tag.count}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-8">
        <h2 className="label mb-3">Monthly volume</h2>
        <div className="panel px-4 py-4">
          <div className="flex items-end gap-[4px]" style={{ height: 90 }}>
            {report.monthly.map((month) => (
              <Link
                key={month.month}
                href={`/timeline?year=${month.month.slice(0, 4)}&month=${Number(month.month.slice(5, 7))}`}
                title={`${monthLabel(month.month)} — ${month.count} entries, ${month.words} words`}
                style={{
                  flex: 1,
                  height: `${Math.max(4, (month.count / Math.max(1, peakCount(report.monthly))) * 100)}%`,
                  background: "var(--accent)",
                  opacity: 0.75,
                  borderRadius: "3px 3px 0 0",
                  minWidth: 8,
                }}
              />
            ))}
          </div>
          <div className="mono mt-2 flex justify-between text-[10px]" style={{ color: "var(--muted-2)" }}>
            <span>{report.monthly[0]?.month}</span>
            <span>{report.monthly[report.monthly.length - 1]?.month}</span>
          </div>
        </div>
      </section>

      <ReflectionPanel
        week={{
          facts: {
            from: weekFacts.from,
            to: weekFacts.to,
            entryCount: weekFacts.entryCount,
            words: weekFacts.words,
            days: weekFacts.days,
            tags: weekFacts.tags.map((t) => t.slug),
            threads: weekFacts.threads.map((t) => t.name),
          },
        }}
        month={{
          facts: {
            from: monthFacts.from,
            to: monthFacts.to,
            entryCount: monthFacts.entryCount,
            words: monthFacts.words,
            days: monthFacts.days,
            tags: monthFacts.tags.map((t) => t.slug),
            threads: monthFacts.threads.map((t) => t.name),
          },
        }}
        aiConfigured={ai.configured}
      />

      <p className="mt-10 text-[11.5px] leading-relaxed" style={{ color: "var(--muted-2)" }}>
        Every number on this page is a count of rows in your diary. Nothing is estimated, modelled, or
        inferred from a sample.
      </p>
    </Shell>
  );
}

function Header({ ai, model }: { ai: boolean; model: string | null }) {
  return (
    <header className="rise">
      <p className="label">Insights</p>
      <h1 className="mt-2 font-serif text-[26px]" style={{ color: "var(--fg)" }}>
        Patterns in what you actually wrote.
      </h1>
      <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>
        {ai
          ? `Reading and interpretation are separated everywhere: facts come from your entries, and anything generated is labelled with the model that produced it (${model}).`
          : "Facts come from your entries. Generated interpretation stays off until you configure an AI provider — set AI_PROVIDER, AI_API_KEY and AI_MODEL, and the reflection panel starts working."}
      </p>
    </header>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="px-4 py-3.5" style={{ background: "var(--panel)" }}>
      <p className="label">{label}</p>
      <p className="mt-1 font-serif text-[19px]" style={{ color: "var(--fg)" }}>
        {value}
      </p>
      {hint ? (
        <p className="mono mt-0.5 text-[10px]" style={{ color: "var(--muted-2)" }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel px-4 py-4">
      <p className="label mb-3">{title}</p>
      {children}
    </div>
  );
}

function Row({
  label,
  value,
  delta,
}: {
  label: string;
  value: React.ReactNode;
  delta?: number;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-[12.5px]" style={{ color: "var(--muted)" }}>
        {label}
      </span>
      <span className="flex items-baseline gap-2 text-[13px]" style={{ color: "var(--fg-2)" }}>
        {value}
        {delta !== undefined && delta !== 0 ? (
          <span className="mono text-[10px]" style={{ color: delta > 0 ? "var(--ok)" : "var(--muted-2)" }}>
            {delta > 0 ? `+${delta}` : delta}
          </span>
        ) : null}
      </span>
    </div>
  );
}

function peak(buckets: { count: number }[]): number {
  return buckets.reduce((max, b) => Math.max(max, b.count), 0);
}

function peakCount(months: { count: number }[]): number {
  return months.reduce((max, m) => Math.max(max, m.count), 0);
}

function describePeak(buckets: { hour: number; count: number }[]): string {
  const best = buckets.reduce((top, b) => (b.count > top.count ? b : top), buckets[0]);
  if (!best || best.count === 0) return "No writing recorded yet.";
  const h = best.hour;
  const label = h < 5 ? "late night" : h < 12 ? "morning" : h < 17 ? "afternoon" : h < 22 ? "evening" : "late night";
  return `Most of your writing happens in the ${label} (peak ${String(h).padStart(2, "0")}:00, ${best.count} entries).`;
}

function computeStreak(heatmap: { day: string; count: number }[]): number {
  const set = new Set(heatmap.filter((c) => c.count > 0).map((c) => c.day));
  const today = heatmap[heatmap.length - 1]?.day;
  if (!today) return 0;
  let cursor = new Date(`${today}T12:00:00Z`);
  if (!set.has(today)) cursor = new Date(cursor.getTime() - 86_400_000);
  let streak = 0;
  for (;;) {
    const key = cursor.toISOString().slice(0, 10);
    if (!set.has(key)) break;
    streak += 1;
    cursor = new Date(cursor.getTime() - 86_400_000);
  }
  return streak;
}

/** Heatmap into GitHub-style columns of 7, oldest first. */
function groupHeatmap(cells: { day: string; count: number; words: number; level: number }[]) {
  const weeks: typeof cells[] = [];
  let current: typeof cells = [];
  for (const cell of cells) {
    const weekday = new Date(`${cell.day}T12:00:00Z`).getUTCDay();
    if (current.length === 7) {
      weeks.push(current);
      current = [];
    }
    if (current.length === 0 && weekday !== 0) {
      // Pad the first partial week so columns line up Monday-first.
      for (let i = 0; i < weekday; i += 1) {
        current.push({ day: `pad-${cell.day}-${i}`, count: 0, words: 0, level: 0 });
      }
    }
    current.push(cell);
  }
  if (current.length) weeks.push(current);
  return weeks;
}
