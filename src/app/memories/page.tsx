import { Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { dayKey, relativeDay, shortDate } from "@/lib/day";
import { memoryDigest } from "@/lib/services/memory-graph";
import Link from "next/link";
import { excerpt } from "@/lib/markdown";
import { EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function MemoriesPage({ searchParams }: PageProps<"/memories">) {
  const params = await searchParams;
  const user = await requireUser();
  const today = dayKey(new Date(), user.timezone);
  const digest = await memoryDigest(user.id, today);

  const tab = typeof params.tab === "string" ? params.tab : "digest";
  const entryCount = await memoryEntryCount(user.id);

  if (entryCount === 0) {
    return (
      <Shell>
        <Header />
        <div className="mt-7">
          <EmptyState
            title="No memories yet."
            body="Memories are pulled from what you actually wrote — nothing is generated. Write a few entries and this page starts resurfacing them."
            action={{ href: "/write", label: "Write an entry" }}
          />
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <Header />

      <nav className="rise mt-6 flex flex-wrap gap-1.5">
        {[
          { id: "digest", label: "Overview" },
          { id: "on-this-day", label: "On this day" },
          { id: "random", label: "Random" },
          { id: "ghosts", label: "Ghost threads" },
          { id: "shifts", label: "Changed my mind" },
        ].map((item) => (
          <Link
            key={item.id}
            href={item.id === "digest" ? "/memories" : `/memories?tab=${item.id}`}
            className="chip"
            data-active={tab === item.id}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {tab === "digest" ? (
        <div className="stagger mt-6 space-y-6">
          {digest.onThisDay ? (
            <MemoryCard
              label={`On this day · ${digest.onThisDay.label}`}
              note={digest.onThisDay.note}
              id={digest.onThisDay.entry.id}
              day={digest.onThisDay.day}
              title={digest.onThisDay.entry.title}
              body={digest.onThisDay.entry.excerpt}
              relative={relativeDay(digest.onThisDay.day, today)}
            />
          ) : (
            <div className="panel px-4 py-4">
              <p className="label mb-1">On this day</p>
              <p className="text-[13px]" style={{ color: "var(--muted)" }}>
                Nothing written on this date in previous years. It stays quiet rather than filling the
                gap with something it made up.
              </p>
            </div>
          )}

          {digest.random ? (
            <MemoryCard
              label={`Random memory · ${digest.random.label}`}
              note={digest.random.note}
              id={digest.random.entry.id}
              day={digest.random.day}
              title={digest.random.entry.title}
              body={digest.random.entry.excerpt}
              relative={relativeDay(digest.random.day, today)}
            />
          ) : null}

          {digest.ghosts.length ? (
            <section className="panel px-4 py-4">
              <p className="label mb-2.5">Threads that went quiet</p>
              <ul className="space-y-2">
                {digest.ghosts.map((ghost) => (
                  <li key={ghost.id} className="flex items-baseline justify-between gap-3">
                    <Link href={`/search?tag=${ghost.slug}`} className="text-[13.5px]" style={{ color: "var(--fg-2)" }}>
                      {ghost.name}
                    </Link>
                    <span className="mono shrink-0 text-[10px]" style={{ color: "var(--muted-2)" }}>
                      {ghost.mentions} mentions · last {relativeDay(ghost.last, today)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {digest.shifts.length ? (
            <section>
              <p className="label mb-3">Your perspective changed</p>
              <div className="space-y-3">
                {digest.shifts.map((shift) => (
                  <div key={`${shift.slug}-${shift.before.id}`} className="panel px-4 py-4">
                    <p className="mono mb-2 text-[10px]" style={{ color: "var(--accent)" }}>
                      {shift.thread} · {Math.round(shift.gapDays / 30)} months apart
                    </p>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <p className="label mb-1">{shift.before.day}</p>
                        <Link href={`/entry/${shift.before.id}`} className="text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>
                          {shift.before.snippet}
                        </Link>
                      </div>
                      <div>
                        <p className="label mb-1">{shift.after.day}</p>
                        <Link href={`/entry/${shift.after.id}`} className="text-[13px] leading-relaxed" style={{ color: "var(--fg-2)" }}>
                          {shift.after.snippet}
                        </Link>
                      </div>
                    </div>
                    <p className="mt-2.5 text-[11px]" style={{ color: "var(--muted-2)" }}>
                      Neither version is more correct — this only shows both.
                    </p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {digest.threads.length ? (
            <section>
              <div className="mb-3 flex items-baseline justify-between">
                <p className="label">Life threads</p>
                <Link href="/threads" className="mono text-[10px]" style={{ color: "var(--muted-2)" }}>
                  detail →
                </Link>
              </div>
              <div className="space-y-2">
                {digest.threads.slice(0, 6).map((thread) => (
                  <Link key={thread.id} href={`/threads?slug=${thread.slug}`} className="panel block px-4 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[14px]" style={{ color: "var(--fg)" }}>
                        {thread.name}
                      </span>
                      <span className="mono text-[10px]" style={{ color: "var(--muted-2)" }}>
                        {thread.mentions} {thread.mentions === 1 ? "entry" : "entries"}
                      </span>
                    </div>
                    {thread.first ? (
                      <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--muted)" }}>
                        {shortDate(thread.first)} → {thread.last ? relativeDay(thread.last, today) : "—"}
                      </p>
                    ) : null}
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      {tab === "on-this-day" ? (
        <div className="mt-6">
          {digest.onThisDay ? (
            <MemoryCard
              label={`On this day · ${digest.onThisDay.label}`}
              note={digest.onThisDay.note}
              id={digest.onThisDay.entry.id}
              day={digest.onThisDay.day}
              title={digest.onThisDay.entry.title}
              body={digest.onThisDay.entry.excerpt}
              relative={relativeDay(digest.onThisDay.day, today)}
            />
          ) : (
            <EmptyState
              title="Nothing from this date."
              body={`No entry exists for ${digest.todayLong.slice(0, -5)} in any previous year.`}
            />
          )}
        </div>
      ) : null}

      {tab === "random" ? (
        <div className="mt-6">
          {digest.random ? (
            <MemoryCard
              label={`Random memory · ${digest.random.label}`}
              note={digest.random.note}
              id={digest.random.entry.id}
              day={digest.random.day}
              title={digest.random.entry.title}
              body={digest.random.entry.excerpt}
              relative={relativeDay(digest.random.day, today)}
            />
          ) : (
            <EmptyState
              title="Not enough history yet."
              body="Random resurfacing only picks entries at least 30 days old, so it stays meaningful."
            />
          )}
          <p className="mt-3 text-[11.5px]" style={{ color: "var(--muted-2)" }}>
            Reload for another one.
          </p>
        </div>
      ) : null}

      {tab === "ghosts" ? (
        <section className="mt-6">
          {digest.ghosts.length ? (
            <div className="space-y-2.5">
              {digest.ghosts.map((ghost) => (
                <div key={ghost.id} className="panel px-4 py-3.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <Link href={`/search?tag=${ghost.slug}`} className="text-[15px]" style={{ color: "var(--fg)" }}>
                      {ghost.name}
                    </Link>
                    <span className="mono text-[10px]" style={{ color: "var(--muted-2)" }}>
                      quiet for {Math.round(ghost.gapDays / 30)} months
                    </span>
                  </div>
                  <p className="mt-1 text-[12.5px]" style={{ color: "var(--muted)" }}>
                    {ghost.mentions} entries between {shortDate(ghost.first)} and {shortDate(ghost.last)}.
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No quiet threads."
              body="A thread appears here when it had at least 3 entries and nothing for 90 days. Nothing qualifies yet."
            />
          )}
        </section>
      ) : null}

      {tab === "shifts" ? (
        <section className="mt-6">
          {digest.shifts.length ? (
            <div className="space-y-3">
              {digest.shifts.map((shift) => (
                <div key={`${shift.slug}-${shift.before.id}`} className="panel px-4 py-4">
                  <p className="mono mb-2 text-[10px]" style={{ color: "var(--accent)" }}>
                    {shift.thread} · {Math.round(shift.gapDays / 30)} months apart
                  </p>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <p className="label mb-1">{shift.before.day}</p>
                      <Link href={`/entry/${shift.before.id}`} className="text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>
                        {shift.before.snippet}
                      </Link>
                    </div>
                    <div>
                      <p className="label mb-1">{shift.after.day}</p>
                      <Link href={`/entry/${shift.after.id}`} className="text-[13px] leading-relaxed" style={{ color: "var(--fg-2)" }}>
                        {shift.after.snippet}
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No shifts detected."
              body="This needs two entries about the same thread at least a month apart with clearly different tone. It compares words you actually used."
            />
          )}
        </section>
      ) : null}
    </Shell>
  );
}

function Header() {
  return (
    <header className="rise">
      <p className="label">Memories</p>
      <h1 className="mt-2 font-serif text-[26px]" style={{ color: "var(--fg)" }}>
        Your life, resurfaced.
      </h1>
      <p className="mt-1.5 text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>
        Every card below is a real entry. When nothing exists for a slot, this page says so instead of
        inventing a memory.
      </p>
    </header>
  );
}

function MemoryCard({
  label,
  note,
  id,
  day,
  title,
  body,
  relative,
}: {
  label: string;
  note: string;
  id: string;
  day: string;
  title: string;
  body: string;
  relative: string;
}) {
  return (
    <Link href={`/entry/${id}`} className="panel block px-4 py-4 transition-colors hover:border-[var(--muted-2)]">
      <div className="flex items-baseline justify-between gap-3">
        <p className="label">{label}</p>
        <span className="mono text-[10px]" style={{ color: "var(--muted-2)" }}>
          {relative}
        </span>
      </div>
      <p className="mt-2 font-serif text-[17px]" style={{ color: "var(--fg)" }}>
        {title}
      </p>
      <p className="mt-1.5 text-[13.5px] leading-relaxed" style={{ color: "var(--muted)" }}>
        {excerpt(body, 420)}
      </p>
      <p className="mono mt-2.5 text-[10px]" style={{ color: "var(--muted-2)" }}>
        {day} · {note}
      </p>
    </Link>
  );
}

async function memoryEntryCount(userId: string): Promise<number> {
  const { prisma } = await import("@/lib/db");
  return prisma.entry.count({ where: { userId, deletedAt: null } });
}
