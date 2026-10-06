import { Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { dayKey, relativeDay, shortDate } from "@/lib/day";
import { ThoughtBoard } from "./thought-board";

export const dynamic = "force-dynamic";

export default async function ThoughtsPage() {
  const user = await requireUser();
  const today = dayKey(new Date(), user.timezone);

  const thoughts = await prisma.unresolvedThought.findMany({
    where: { userId: user.id },
    include: {
      firstEntry: { select: { id: true, day: true } },
      lastEntry: { select: { id: true, day: true } },
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
  });

  const open = thoughts.filter((t) => t.status === "open");
  const closed = thoughts.filter((t) => t.status !== "open");

  return (
    <Shell>
      <header className="rise">
        <p className="label">Unresolved thoughts</p>
        <h1 className="mt-2 font-serif text-[26px]" style={{ color: "var(--fg)" }}>
          Things you haven&apos;t settled.
        </h1>
        <p className="mt-1.5 max-w-lg text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>
          Nothing lands here automatically — you decide what counts as unresolved. Use Discord&apos;s{" "}
          <code className="mono">question:</code> prefix, or add one below with the exact wording you
          used.
        </p>
      </header>

      <div className="rise mt-6" style={{ animationDelay: "60ms" }}>
        <ThoughtBoard
          open={open.map((t) => serialize(t, today))}
          closed={closed.map((t) => serialize(t, today))}
        />
      </div>
    </Shell>
  );
}

type ThoughtRow = {
  id: string;
  question: string;
  note: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  resolvedNote: string | null;
  firstEntry: { id: string; day: string } | null;
  lastEntry: { id: string; day: string } | null;
};

function serialize(thought: ThoughtRow, today: string) {
  return {
    id: thought.id,
    question: thought.question,
    note: thought.note,
    status: thought.status,
    createdDay: thought.createdAt.toISOString().slice(0, 10),
    ageDays: Math.floor((Date.now() - thought.createdAt.getTime()) / 86_400_000),
    firstMention: thought.firstEntry ? { id: thought.firstEntry.id, day: thought.firstEntry.day } : null,
    lastMention: thought.lastEntry ? { id: thought.lastEntry.id, day: thought.lastEntry.day } : null,
    updatedLabel: relativeDay(thought.updatedAt.toISOString().slice(0, 10), today),
    resolvedNote: thought.resolvedNote,
    createdLabel: shortDate(thought.createdAt.toISOString().slice(0, 10)),
  };
}
