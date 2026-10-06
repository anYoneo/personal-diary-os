import { Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { dayKey, relativeDay, shortDate } from "@/lib/day";
import { lifeThreads } from "@/lib/services/memory-graph";
import { ThreadForm } from "./thread-form";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ThreadsPage({ searchParams }: PageProps<"/threads">) {
  const params = await searchParams;
  const user = await requireUser();
  const today = dayKey(new Date(), user.timezone);
  const threads = await lifeThreads(user.id);

  const selectedSlug = typeof params.slug === "string" ? params.slug : null;
  const selected = selectedSlug ? threads.find((t) => t.slug === selectedSlug) : null;

  const selectedEntries = selected
    ? await prisma.entry.findMany({
        where: {
          userId: user.id,
          deletedAt: null,
          threads: { some: { threadId: selected.id } },
        },
        orderBy: { occurredAt: "desc" },
        take: 30,
        select: { id: true, day: true, title: true, content: true },
      })
    : [];

  return (
    <Shell>
      <header className="rise">
        <p className="label">Life threads</p>
        <h1 className="mt-2 font-serif text-[26px]" style={{ color: "var(--fg)" }}>
          The subjects that keep coming back.
        </h1>
        <p className="mt-1.5 max-w-lg text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>
          A thread is a long-running subject you tag entries with. This view shows its first mention,
          its last, and how often it recurs — built only from entries that exist.
        </p>
      </header>

      <div className="rise mt-6" style={{ animationDelay: "60ms" }}>
        <ThreadForm />
      </div>

      {threads.length === 0 ? (
        <div className="panel mt-7 px-5 py-9 text-center">
          <p className="font-serif text-[16px]" style={{ color: "var(--fg-2)" }}>
            No threads yet.
          </p>
          <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>
            Create one above — Career, Health, a project, a person — then tag entries with it while
            writing.
          </p>
        </div>
      ) : (
        <div className="stagger mt-7 space-y-2.5">
          {threads.map((thread) => (
            <div key={thread.id} className="panel px-4 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex items-baseline gap-2.5">
                  <Link
                    href={`/threads?slug=${thread.slug}`}
                    className="font-serif text-[17px]"
                    style={{ color: selected?.slug === thread.slug ? "var(--accent)" : "var(--fg)" }}
                  >
                    {thread.name}
                  </Link>
                  <span className="mono text-[10px] uppercase tracking-[0.12em]" style={{ color: "var(--muted-2)" }}>
                    {thread.kind}
                  </span>
                  {thread.status !== "active" ? (
                    <span className="mono text-[10px]" style={{ color: "var(--muted-2)" }}>
                      {thread.status}
                    </span>
                  ) : null}
                </div>
                <span className="mono text-[10px]" style={{ color: "var(--muted-2)" }}>
                  {thread.mentions} {thread.mentions === 1 ? "entry" : "entries"}
                  {thread.last ? ` · last ${relativeDay(thread.last, today)}` : ""}
                </span>
              </div>

              {thread.first ? (
                <p className="mt-1 text-[12px]" style={{ color: "var(--muted)" }}>
                  First mentioned {shortDate(thread.first)}
                  {thread.last && thread.last !== thread.first ? ` · last ${shortDate(thread.last)}` : ""}
                </p>
              ) : (
                <p className="mt-1 text-[12px]" style={{ color: "var(--muted-2)" }}>
                  No entries tagged with this thread yet.
                </p>
              )}

              {thread.byMonth.length > 0 ? (
                <div className="mt-3 flex items-end gap-[3px]">
                  {thread.byMonth.map((bucket) => (
                    <span
                      key={bucket.month}
                      title={`${bucket.month} — ${bucket.count}`}
                      style={{
                        width: 9,
                        height: 5 + Math.min(bucket.count, 10) * 3,
                        background: "var(--accent)",
                        opacity: thread.status === "active" ? 0.8 : 0.4,
                        borderRadius: 2,
                        display: "inline-block",
                      }}
                    />
                  ))}
                  <span className="mono ml-2 text-[10px]" style={{ color: "var(--muted-2)" }}>
                    {thread.byMonth.length} months
                  </span>
                </div>
              ) : null}

              {thread.goals.length ? (
                <ul className="mt-3 space-y-1">
                  {thread.goals.map((goal) => (
                    <li key={goal.id} className="flex items-center gap-2 text-[12.5px]" style={{ color: "var(--muted)" }}>
                      <span
                        aria-hidden
                        className="h-[5px] w-[5px] rounded-full"
                        style={{ background: goal.status === "done" ? "var(--ok)" : "var(--accent)" }}
                      />
                      {goal.title}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {selected ? (
        <section className="mt-10">
          <h2 className="label mb-3">{selected.name} · entries</h2>
          <div className="space-y-2">
            {selectedEntries.map((entry) => (
              <Link key={entry.id} href={`/entry/${entry.id}`} className="panel block px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[14px]" style={{ color: "var(--fg)" }}>
                    {entry.title?.trim() || entry.content.slice(0, 60)}
                  </span>
                  <span className="mono shrink-0 text-[10px]" style={{ color: "var(--muted-2)" }}>
                    {entry.day}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-[12.5px]" style={{ color: "var(--muted)" }}>
                  {entry.content.slice(0, 180)}
                </p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </Shell>
  );
}
