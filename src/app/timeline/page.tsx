import { Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { dayKey, monthLabel, parseDayKey, relativeDay } from "@/lib/day";
import Link from "next/link";
import { MoodChip, TypeBadge } from "@/components/ui";
import { excerpt } from "@/lib/markdown";

export const dynamic = "force-dynamic";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default async function TimelinePage({ searchParams }: PageProps<"/timeline">) {
  const params = await searchParams;
  const user = await requireUser();
  const today = dayKey(new Date(), user.timezone);

  const yearParam = typeof params.year === "string" ? Number(params.year) : NaN;
  const monthParam = typeof params.month === "string" ? Number(params.month) : NaN;

  const entries = await prisma.entry.findMany({
    where: { userId: user.id, deletedAt: null },
    orderBy: { occurredAt: "desc" },
    include: { tags: { include: { tag: true } } },
  });

  const years = [...new Set(entries.map((e) => Number(e.day.slice(0, 4))))].sort((a, b) => b - a);
  const year = Number.isFinite(yearParam) && years.includes(yearParam)
    ? yearParam
    : (years[0] ?? new Date().getFullYear());

  const yearEntries = entries.filter((e) => Number(e.day.slice(0, 4)) === year);
  const monthsPresent = [...new Set(yearEntries.map((e) => Number(e.day.slice(5, 7))))].sort((a, b) => b - a);
  const monthsInYear = monthsPresent.length ? monthsPresent : [9];

  const month = Number.isFinite(monthParam) && monthsPresent.includes(monthParam)
    ? monthParam
    : (monthsPresent[0] ?? 9);

  const visible = yearEntries.filter((e) => Number(e.day.slice(5, 7)) === month);

  // Group into days so the rail reads like a journal, not a table.
  const byDay = new Map<string, typeof visible>();
  for (const entry of visible) {
    byDay.set(entry.day, [...(byDay.get(entry.day) ?? []), entry]);
  }
  const days = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));

  // Year overview: entry counts per month, so navigation is informative.
  const perMonth = new Map<number, number>();
  for (const entry of yearEntries) {
    const m = Number(entry.day.slice(5, 7));
    perMonth.set(m, (perMonth.get(m) ?? 0) + 1);
  }

  const trashCount = await prisma.entry.count({ where: { userId: user.id, deletedAt: { not: null } } });

  return (
    <Shell>
      <header className="rise">
        <p className="label">Timeline</p>
        <h1 className="mt-2 font-serif text-[26px]" style={{ color: "var(--fg)" }}>
          {entries.length} {entries.length === 1 ? "entry" : "entries"} · {years.length}{" "}
          {years.length === 1 ? "year" : "years"}
        </h1>
      </header>

      {entries.length === 0 ? (
        <div className="panel mt-7 px-5 py-10 text-center">
          <p className="font-serif text-[17px]" style={{ color: "var(--fg-2)" }}>
            The timeline is empty.
          </p>
          <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>
            As you write, this becomes a month-by-month view of your life — and the fastest way back
            into old thinking.
          </p>
          <Link href="/write" className="btn btn-accent mt-5">
            Write the first entry
          </Link>
        </div>
      ) : (
        <>
          <nav className="rise mt-7 flex flex-wrap items-center gap-1.5" style={{ animationDelay: "60ms" }}>
            {years.map((y) => (
              <Link key={y} href={`/timeline?year=${y}`} className="chip" data-active={y === year}>
                {y}
              </Link>
            ))}
            {trashCount > 0 ? (
              <Link href="/trash" className="chip ml-auto" title="Deleted entries are kept here">
                trash · {trashCount}
              </Link>
            ) : null}
          </nav>

          <nav className="rise mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5" style={{ animationDelay: "90ms" }}>
            {Array.from({ length: 12 }, (_, i) => i + 1)
              .reverse()
              .map((m) => {
                const count = perMonth.get(m) ?? 0;
                return (
                  <Link
                    key={m}
                    href={`/timeline?year=${year}&month=${m}`}
                    className="mono text-[11px] transition-colors"
                    style={{
                      color: m === month ? "var(--accent)" : count ? "var(--muted)" : "var(--muted-2)",
                      opacity: count ? 1 : 0.45,
                    }}
                    title={`${MONTH_NAMES[m - 1]} ${year} — ${count} entries`}
                  >
                    {MONTH_NAMES[m - 1].slice(0, 3)}
                    {count ? <span style={{ color: "var(--muted-2)" }}> {count}</span> : null}
                  </Link>
                );
              })}
          </nav>

          <div className="mt-8">
            <p className="label mb-4">{monthLabel(`${year}-${String(month).padStart(2, "0")}`)}</p>

            {days.length === 0 ? (
              <div className="panel px-5 py-8 text-center">
                <p className="text-[13.5px]" style={{ color: "var(--muted)" }}>
                  Nothing written in {MONTH_NAMES[month - 1]} {year}.
                </p>
                {monthsInYear.length > 1 || monthsPresent.length ? null : null}
              </div>
            ) : (
              <div className="rail stagger">
                {days.map(([day, dayEntries]) => (
                  <div key={day} className="mb-6">
                    <p className="rail-node mono mb-2 text-[11px]" style={{ color: "var(--muted)" }}>
                      {relativeDay(day, today)} · {day}
                    </p>
                    <div className="space-y-2">
                      {dayEntries.map((entry) => (
                        <Link
                          key={entry.id}
                          href={`/entry/${entry.id}`}
                          className="panel block px-4 py-3 transition-colors hover:border-[var(--muted-2)]"
                          style={{ marginLeft: "28px" }}
                        >
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="font-serif text-[15.5px]" style={{ color: "var(--fg)" }}>
                              {entry.title?.trim() || excerpt(entry.content, 55)}
                            </span>
                            <span className="flex shrink-0 items-center gap-2">
                              {entry.isImportant ? (
                                <span aria-hidden title="Marked important" style={{ color: "var(--accent)" }}>
                                  ★
                                </span>
                              ) : null}
                              <MoodChip mood={entry.mood} />
                            </span>
                          </div>
                          <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed" style={{ color: "var(--muted)" }}>
                            {excerpt(entry.content, 160)}
                          </p>
                          <div className="mt-2 flex items-center gap-2.5">
                            <TypeBadge type={entry.entryType} />
                            <span className="mono text-[10px]" style={{ color: "var(--muted-2)" }}>
                              {entry.wordCount}w
                            </span>
                            {entry.source === "discord" ? (
                              <span className="mono text-[10px]" style={{ color: "var(--info)" }}>
                                discord
                              </span>
                            ) : null}
                            {entry.tags.slice(0, 3).map((t) => (
                              <span key={t.tag.slug} className="mono text-[10px]" style={{ color: "var(--muted-2)" }}>
                                #{t.tag.slug}
                              </span>
                            ))}
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <footer className="mt-10 border-t pt-4" style={{ borderColor: "var(--line-soft)" }}>
            <p className="mono text-[11px]" style={{ color: "var(--muted-2)" }}>
              {yearEntries.length} entries in {year} ·{" "}
              {yearEntries.reduce((sum, e) => sum + e.wordCount, 0).toLocaleString("en-US")} words ·
              first {parseDayKey(yearEntries[yearEntries.length - 1]?.day ?? today).toISOString().slice(0, 10)}
            </p>
          </footer>
        </>
      )}
    </Shell>
  );
}
