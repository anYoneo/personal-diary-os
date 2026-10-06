import { Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { dayKey, greeting, longDate, relativeDay } from "@/lib/day";
import { homeSummary, entryPreview } from "@/lib/services/entries";
import { prisma } from "@/lib/db";
import { excerpt } from "@/lib/markdown";
import Link from "next/link";
import { MoodChip, TagPills, TypeBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const user = await requireUser();
  const now = new Date();
  const summary = await homeSummary(user.id, user.timezone, true);
  const day = dayKey(now, user.timezone);

  const wroteToday = summary.todayEntries.length > 0;
  const previous = summary.todayEntries.length ? null : summary.lastEntry;

  const activity = await prisma.entry.findMany({
    where: { userId: user.id, deletedAt: null },
    select: { day: true },
    orderBy: { day: "desc" },
    take: 300,
  });
  const lastWrite = previous ? relativeDay(previous.day, day) : null;

  return (
    <Shell>
      <header className="rise">
        <p className="label">{longDate(day)}</p>
        <h1 className="mt-3 font-serif text-[32px] leading-[1.15]" style={{ color: "var(--fg)" }}>
          {greeting(now, user.timezone)}.
        </h1>
        <p className="mt-1.5 text-[14px]" style={{ color: "var(--muted)" }}>
          {wroteToday
            ? `You already wrote ${summary.todayEntries.length === 1 ? "an entry" : `${summary.todayEntries.length} entries`} today.`
            : lastWrite
              ? `Last written ${lastWrite}.`
              : "Nothing here yet. The first entry is the only hard one."}
        </p>
      </header>

      <div className="rise mt-7 flex flex-wrap items-center gap-2.5" style={{ animationDelay: "60ms" }}>
        <Link href="/write" className="btn btn-accent">
          {wroteToday ? "Write another entry" : "Start writing"}
        </Link>
        {summary.todayEntries.length ? (
          <Link href={`/entry/${summary.todayEntries[0].id}`} className="btn">
            Open today&apos;s entry
          </Link>
        ) : null}
        <Link href="/memories" className="btn btn-ghost">
          Resurface a memory
        </Link>
      </div>

      <section
        className="rise mt-9 grid grid-cols-3 gap-px overflow-hidden rounded-[12px] border"
        style={{ borderColor: "var(--line-soft)", animationDelay: "120ms" }}
      >
        <Stat label="Streak" value={`${summary.streak}${summary.streak === 1 ? " day" : " days"}`} />
        <Stat label="This week" value={`${summary.weekCount} ${summary.weekCount === 1 ? "entry" : "entries"}`} />
        <Stat label="Words this week" value={summary.wordsThisWeek.toLocaleString("en-US")} />
      </section>

      {summary.prompt ? (
        <section
          className="rise mt-8 border-l-2 pl-4"
          style={{ borderColor: "var(--accent-line)", animationDelay: "160ms" }}
        >
          <p className="label mb-1.5">Prompt for today</p>
          <p className="font-serif text-[19px] italic leading-snug" style={{ color: "var(--fg-2)" }}>
            {summary.prompt}
          </p>
        </section>
      ) : null}

      {summary.todayEntries.length ? (
        <Section title="Today">
          <div className="stagger space-y-2.5">
            {summary.todayEntries.map((entry) => {
              const preview = entryPreview(entry);
              return (
                <Link
                  key={entry.id}
                  href={`/entry/${entry.id}`}
                  className="panel block px-4 py-3.5 transition-colors hover:border-[var(--muted-2)]"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-serif text-[16px]" style={{ color: "var(--fg)" }}>
                      {preview.title}
                    </span>
                    <MoodChip mood={entry.mood} />
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>
                    {preview.excerpt}
                  </p>
                  <div className="mt-2.5 flex items-center gap-3">
                    <TypeBadge type={entry.entryType} />
                    <TagPills tags={preview.tags} />
                  </div>
                </Link>
              );
            })}
          </div>
        </Section>
      ) : previous ? (
        <Section title="Where you left off">
          <Link href={`/entry/${previous.id}`} className="panel block px-4 py-3.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-serif text-[16px]" style={{ color: "var(--fg)" }}>
                {previous.title?.trim() || excerpt(previous.content, 60)}
              </span>
              <span className="mono shrink-0 text-[10px]" style={{ color: "var(--muted-2)" }}>
                {relativeDay(previous.day, day)}
              </span>
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>
              {excerpt(previous.content, 240)}
            </p>
          </Link>
        </Section>
      ) : (
        <Section title="Where you left off">
          <div className="panel px-5 py-8 text-center">
            <p className="font-serif text-[16px]" style={{ color: "var(--fg-2)" }}>
              This page becomes a map of your life.
            </p>
            <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>
              Write the first entry and it starts keeping track: streaks, threads, and memories that
              resurface on their own.
            </p>
          </div>
        </Section>
      )}

      {summary.onThisDay.length ? (
        <Section title="On this day">
          <div className="space-y-2.5">
            {summary.onThisDay.slice(0, 2).map((bucket) => (
              <div key={bucket.year} className="panel px-4 py-3.5">
                <p className="label mb-1.5">
                  {bucket.year} ·{" "}
                  {Number(day.slice(0, 4)) - bucket.year === 1
                    ? "a year ago"
                    : `${Number(day.slice(0, 4)) - bucket.year} years ago`}
                </p>
                {bucket.entries.map((entry) => (
                  <Link key={entry.id} href={`/entry/${entry.id}`} className="block">
                    <p className="font-serif text-[15px]" style={{ color: "var(--fg)" }}>
                      {entry.title?.trim() || excerpt(entry.content, 50)}
                    </p>
                    <p className="mt-1 text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>
                      {excerpt(entry.content, 180)}
                    </p>
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {summary.themes.length ? (
        <Section title="Recent themes">
          <div className="flex flex-wrap gap-2">
            {summary.themes.map((theme) => (
              <Link key={theme.slug} href={`/search?tag=${theme.slug}`} className="chip">
                #{theme.name}
                <span style={{ color: "var(--muted-2)" }}>{theme.count}</span>
              </Link>
            ))}
          </div>
        </Section>
      ) : null}

      {summary.thoughts.length ? (
        <Section title={`Unresolved (${summary.unresolvedCount})`} href="/thoughts">
          <ul className="space-y-2">
            {summary.thoughts.map((thought) => (
              <li key={thought.id}>
                <Link href="/thoughts" className="rail-node block py-1.5">
                  <p className="text-[13.5px] leading-snug" style={{ color: "var(--fg-2)" }}>
                    {thought.question}
                  </p>
                  <p className="mono mt-0.5 text-[10px]" style={{ color: "var(--muted-2)" }}>
                    open {relativeDay(thought.updatedAt.toISOString().slice(0, 10), day)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {summary.goals.length ? (
        <Section title="Goals" href="/goals">
          <ul className="space-y-1.5">
            {summary.goals.map((goal) => (
              <li
                key={goal.id}
                className="flex items-center gap-2.5 text-[13.5px]"
                style={{ color: "var(--fg-2)" }}
              >
                <span aria-hidden className="h-[5px] w-[5px] rounded-full" style={{ background: "var(--accent)" }} />
                {goal.title}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {activity.length ? (
        <Section title="Last 8 weeks">
          <div className="flex flex-wrap gap-[3px]">
            {buildWeeks(activity.map((a) => a.day), day).map((cell) => (
              <span
                key={cell.day}
                className="streak-cell"
                data-level={cell.level}
                title={`${cell.day} — ${cell.count} ${cell.count === 1 ? "entry" : "entries"}`}
              />
            ))}
          </div>
          <p className="mt-2 text-[11px]" style={{ color: "var(--muted-2)" }}>
            {activity.length} entries across {new Set(activity.map((a) => a.day)).size} days.
          </p>
        </Section>
      ) : null}
    </Shell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-3.5" style={{ background: "var(--panel)" }}>
      <p className="label">{label}</p>
      <p className="mt-1 font-serif text-[19px]" style={{ color: "var(--fg)" }}>
        {value}
      </p>
    </div>
  );
}

function Section({
  title,
  href,
  children,
}: {
  title: string;
  href?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-9">
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="label">{title}</h2>
        {href ? (
          <Link
            href={href}
            className="mono text-[10px] transition-colors hover:text-[var(--fg-2)]"
            style={{ color: "var(--muted-2)" }}
          >
            view all →
          </Link>
        ) : null}
      </header>
      {children}
    </section>
  );
}

/** Counts per day for the last 8 weeks, oldest first. */
function buildWeeks(days: string[], today: string) {
  const counts = new Map<string, number>();
  for (const day of days) counts.set(day, (counts.get(day) ?? 0) + 1);

  const cells: { day: string; count: number; level: number }[] = [];
  const end = new Date(`${today}T12:00:00Z`);
  for (let i = 55; i >= 0; i -= 1) {
    const date = new Date(end);
    date.setUTCDate(date.getUTCDate() - i);
    const key = date.toISOString().slice(0, 10);
    const count = counts.get(key) ?? 0;
    cells.push({
      day: key,
      count,
      level: count === 0 ? 0 : count === 1 ? 1 : count === 2 ? 2 : count === 3 ? 3 : 4,
    });
  }
  return cells;
}
