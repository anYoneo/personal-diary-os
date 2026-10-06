import { Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { TrashList } from "./trash-list";
import { excerpt } from "@/lib/markdown";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function TrashPage() {
  const user = await requireUser();

  const entries = await prisma.entry.findMany({
    where: { userId: user.id, deletedAt: { not: null } },
    orderBy: { deletedAt: "desc" },
    select: { id: true, day: true, title: true, content: true, deletedAt: true, wordCount: true },
  });

  return (
    <Shell>
      <header className="rise">
        <p className="label">Trash</p>
        <h1 className="mt-2 font-serif text-[26px]" style={{ color: "var(--fg)" }}>
          Deleted entries.
        </h1>
        <p className="mt-1.5 max-w-lg text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>
          Deleting moves an entry here instead of erasing it. Restore it, or purge it permanently —
          purging is logged and cannot be undone.
        </p>
      </header>

      {entries.length === 0 ? (
        <div className="panel mt-7 px-5 py-9 text-center">
          <p className="font-serif text-[16px]" style={{ color: "var(--fg-2)" }}>
            Nothing in the trash.
          </p>
          <Link href="/timeline" className="btn mt-4">
            Back to timeline
          </Link>
        </div>
      ) : (
        <div className="rise mt-6" style={{ animationDelay: "60ms" }}>
          <TrashList
            entries={entries.map((entry) => ({
              id: entry.id,
              day: entry.day,
              title: entry.title?.trim() || excerpt(entry.content, 60),
              excerpt: excerpt(entry.content, 160),
              wordCount: entry.wordCount,
              deletedAt: entry.deletedAt?.toISOString() ?? null,
            }))}
          />
        </div>
      )}
    </Shell>
  );
}
