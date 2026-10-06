import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { dayKey } from "@/lib/day";
import { AppShell } from "./app-shell";

/** Pages use this so nav counts are always real, never estimated. */
export async function Shell({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const today = dayKey(new Date(), user.timezone);

  const [todayCount, thoughts, goals] = await Promise.all([
    prisma.entry.count({ where: { userId: user.id, day: today, deletedAt: null } }),
    prisma.unresolvedThought.count({ where: { userId: user.id, status: "open" } }),
    prisma.goal.count({ where: { userId: user.id, status: "open" } }),
  ]);

  return (
    <AppShell
      email={user.email}
      counts={{ today: todayCount, thoughts, goals }}
    >
      {children}
    </AppShell>
  );
}
