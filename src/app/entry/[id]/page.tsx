import { Shell } from "@/components/shell";
import { Editor } from "@/components/editor";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getEntry } from "@/lib/services/entries";
import { notFound } from "next/navigation";
import Link from "next/link";
import { longDate, timeOfDay, relativeDay, dayKey } from "@/lib/day";

export const dynamic = "force-dynamic";

export default async function EntryPage({ params }: PageProps<"/entry/[id]">) {
  const { id } = await params;
  const user = await requireUser();

  const entry = await getEntry(user.id, id).catch(() => null);
  if (!entry) notFound();

  const threads = await prisma.thread.findMany({
    where: { userId: user.id, status: { not: "archived" } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const today = dayKey(new Date(), user.timezone);

  return (
    <Shell>
      <div className="rise">
        <nav className="mb-5 flex items-center gap-2 text-[11px]">
          <Link href="/timeline" className="mono transition-colors hover:text-[var(--fg-2)]" style={{ color: "var(--muted-2)" }}>
            timeline
          </Link>
          <span aria-hidden style={{ color: "var(--muted-2)" }}>
            /
          </span>
          <span className="mono" style={{ color: "var(--muted)" }}>
            {relativeDay(entry.day, today)}
          </span>
          {entry.source === "discord" ? (
            <>
              <span aria-hidden style={{ color: "var(--muted-2)" }}>
                ·
              </span>
              <span className="mono" style={{ color: "var(--info)" }}>
                captured in discord
              </span>
            </>
          ) : null}
        </nav>

        <div className="mb-6 border-l-2 pl-3.5" style={{ borderColor: "var(--accent-line)" }}>
          <p className="label">Original entry</p>
          <p className="mt-1 font-serif text-[17px]" style={{ color: "var(--fg)" }}>
            {longDate(entry.day)} · {timeOfDay(entry.occurredAt, user.timezone)}
          </p>
          {entry.location ? (
            <p className="mono mt-0.5 text-[11px]" style={{ color: "var(--muted-2)" }}>
              {entry.location}
            </p>
          ) : null}
        </div>

        <Editor
          threads={threads}
          autoFocus={false}
          initial={{
            id: entry.id,
            title: entry.title,
            content: entry.content,
            entryType: entry.entryType,
            mood: entry.mood,
            occurredAt: entry.occurredAt.toISOString(),
            location: entry.location,
            isImportant: entry.isImportant,
            tags: entry.tags.map((t) => t.tag.slug),
            threads: entry.threads.map((t) => ({ id: t.thread.id, name: t.thread.name })),
            version: entry.version,
          }}
        />
      </div>
    </Shell>
  );
}
