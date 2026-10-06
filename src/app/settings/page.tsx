import { Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { SettingsForm } from "./settings-form";
import { InvitePanel } from "./invite-panel";
import { isBetaAdmin } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { headers } from "next/headers";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();
  const operator = isBetaAdmin(user);
  // Built on the server: the register link must show a real URL, and reading
  // window.location during render would break the server pass.
  const host = (await headers()).get("host") ?? "";
  const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  const origin = host ? `${proto}://${host}` : "";

  const [settings, link, reminders, trashCount, pending, invites] = await Promise.all([
    prisma.userSettings.findUnique({ where: { userId: user.id } }),
    prisma.discordLink.findUnique({ where: { userId: user.id } }),
    prisma.reminder.findMany({
      where: { userId: user.id, status: "pending" },
      orderBy: { remindAt: "asc" },
      take: 10,
    }),
    prisma.entry.count({ where: { userId: user.id, deletedAt: { not: null } } }),
    prisma.notificationOutbox.groupBy({
      by: ["status"],
      where: { userId: user.id },
      _count: { _all: true },
    }),
    // Only the operator manages the door to this instance.
    operator
      ? prisma.signupCode.findMany({ orderBy: { createdAt: "desc" }, take: 100 })
      : Promise.resolve([]),
  ]);

  return (
    <Shell>
      <header className="rise">
        <p className="label">Settings</p>
        <h1 className="mt-2 font-serif text-[26px]" style={{ color: "var(--fg)" }}>
          How this diary behaves.
        </h1>
        <p className="mt-1.5 text-[13px]" style={{ color: "var(--muted)" }}>
          Signed in as {user.email}
        </p>
      </header>

      <div className="rise mt-6" style={{ animationDelay: "60ms" }}>
        <SettingsForm
          initial={{
            timezone: settings?.timezone ?? user.timezone,
            notifyOnEntry: settings?.notifyOnEntry ?? true,
            notifyOnReminder: settings?.notifyOnReminder ?? true,
            weeklyReflection: settings?.weeklyReflection ?? true,
            onThisDay: settings?.onThisDay ?? true,
            reflectionPrompt: settings?.reflectionPrompt ?? true,
            quietHoursStart: settings?.quietHoursStart ?? null,
            quietHoursEnd: settings?.quietHoursEnd ?? null,
          }}
          discord={{
            linked: Boolean(link),
            username: link?.username ?? null,
            linkedAt: link?.linkedAt.toISOString() ?? null,
          }}
          reminders={reminders.map((r) => ({
            id: r.id,
            text: r.text,
            remindAt: r.remindAt.toISOString(),
            recurrence: r.recurrence,
          }))}
          outbox={pending.map((row) => ({ status: row.status, count: row._count._all }))}
          trashCount={trashCount}
        />
      </div>

      {operator ? (
        <section className="rise mt-10 border-t pt-5" style={{ borderColor: "var(--line-soft)" }}>
          <p className="label mb-2">Invitations</p>
          <h2 className="mb-3 font-serif text-[19px]" style={{ color: "var(--fg)" }}>
            Let someone else in.
          </h2>
          <InvitePanel
            origin={origin}
            initial={invites.map((c) => ({
              id: c.id,
              code: c.code,
              note: c.note,
              maxUses: c.maxUses,
              usedCount: c.usedCount,
              expiresAt: c.expiresAt?.toISOString() ?? null,
            }))}
          />
        </section>
      ) : null}

      <section className="mt-10 border-t pt-5" style={{ borderColor: "var(--line-soft)" }}>
        <p className="label mb-2">Data</p>
        <ul className="space-y-1.5 text-[12.5px]" style={{ color: "var(--muted)" }}>
          <li>
            Everything is stored in a local SQLite file (<code className="mono">prisma/dev.db</code>) —
            nothing is sent anywhere except the Discord and AI services you configure yourself.
          </li>
          <li>
            Deleted entries go to{" "}
            <Link href="/trash" className="underline">
              trash
            </Link>{" "}
            and are only removed when you purge them.
          </li>
          <li>Diary text never enters application logs; only action names and ids are audited.</li>
          <li>
            {operator
              ? "You run this instance. You can see the database file itself — entries written by people you invited are private from one another, not from you."
              : "Your entries are private to your account. Note that whoever runs this server can read the database file, so treat it as private from other users rather than from the operator."}
          </li>
        </ul>
      </section>
    </Shell>
  );
}
