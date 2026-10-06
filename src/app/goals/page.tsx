import { Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { GoalBoard } from "./goal-board";

export const dynamic = "force-dynamic";

export default async function GoalsPage() {
  const user = await requireUser();

  const [goals, threads] = await Promise.all([
    prisma.goal.findMany({
      where: { userId: user.id },
      include: { thread: { select: { id: true, name: true, slug: true } }, entry: { select: { id: true, day: true } } },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    }),
    prisma.thread.findMany({
      where: { userId: user.id, status: { not: "archived" } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <Shell>
      <header className="rise">
        <p className="label">Goals</p>
        <h1 className="mt-2 font-serif text-[26px]" style={{ color: "var(--fg)" }}>
          What you&apos;re trying to move.
        </h1>
        <p className="mt-1.5 max-w-lg text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>
          Goals live alongside entries, not in a separate universe. Link one to a thread and it shows up
          wherever that thread is discussed.
        </p>
      </header>

      <div className="rise mt-6" style={{ animationDelay: "60ms" }}>
        <GoalBoard
          threads={threads}
          goals={goals.map((goal) => ({
            id: goal.id,
            title: goal.title,
            detail: goal.detail,
            status: goal.status,
            thread: goal.thread,
            targetDate: goal.targetDate?.toISOString().slice(0, 10) ?? null,
            completedDay: goal.completedAt?.toISOString().slice(0, 10) ?? null,
            createdDay: goal.createdAt.toISOString().slice(0, 10),
            sourceEntry: goal.entry,
          }))}
        />
      </div>
    </Shell>
  );
}
