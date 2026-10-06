"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "./theme";
import { SignOutButton } from "./sign-out";

export type NavCounts = {
  today: number;
  thoughts: number;
  goals: number;
};

const NAV = [
  { href: "/", label: "Today", key: "today" as const },
  { href: "/write", label: "Write", key: null },
  { href: "/timeline", label: "Timeline", key: null },
  { href: "/search", label: "Search", key: null },
  { href: "/memories", label: "Memories", key: null },
  { href: "/threads", label: "Threads", key: null },
  { href: "/thoughts", label: "Open thoughts", key: "thoughts" as const },
  { href: "/goals", label: "Goals", key: "goals" as const },
  { href: "/insights", label: "Insights", key: null },
];

/**
 * Persistent shell. One rail, nothing else — the writing surface stays the
 * widest thing on screen.
 */
export function AppShell({
  children,
  counts,
  email,
  wide = false,
}: {
  children: React.ReactNode;
  counts: NavCounts;
  email: string;
  wide?: boolean;
}) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="relative z-10 flex min-h-screen">
      <aside
        className="sticky top-0 hidden h-screen w-[212px] shrink-0 flex-col border-r px-3 py-5 md:flex"
        style={{ borderColor: "var(--line-soft)", background: "color-mix(in oklab, var(--bg) 88%, var(--panel))" }}
      >
        <Link href="/" className="mb-7 flex items-baseline gap-2 px-2">
          <span className="font-serif text-[19px]" style={{ color: "var(--fg)" }}>
            Diary
          </span>
          <span className="mono text-[9px]" style={{ color: "var(--muted-2)" }}>
            OS
          </span>
        </Link>

        <nav className="flex flex-1 flex-col gap-0.5">
          {NAV.map((item) => {
            const active = isActive(item.href);
            const count = item.key ? counts[item.key] : 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="group flex items-center justify-between rounded-[8px] px-2.5 py-[7px] text-[13px] transition-colors"
                style={{
                  background: active ? "var(--panel-2)" : "transparent",
                  color: active ? "var(--fg)" : "var(--muted)",
                }}
              >
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="h-[3px] w-[3px] rounded-full transition-colors"
                    style={{ background: active ? "var(--accent)" : "transparent" }}
                  />
                  {item.label}
                </span>
                {count > 0 ? (
                  <span className="mono text-[10px]" style={{ color: "var(--muted-2)" }}>
                    {count}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="mt-4 flex items-center justify-between gap-3 border-t pt-3" style={{ borderColor: "var(--line-soft)" }}>
          <Link
            href="/settings"
            className="min-w-0 truncate px-1 text-[11px] transition-colors hover:text-[var(--fg-2)]"
            style={{ color: "var(--muted-2)" }}
            title={email}
          >
            {email.split("@")[0]}
          </Link>
          <span className="flex shrink-0 items-center gap-0.5">
            <ThemeToggle />
            <SignOutButton />
          </span>
        </div>
      </aside>

      {/* Mobile: a single row of links, scrollable, no drawer to fight with. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <nav
          className="sticky top-0 z-20 flex items-center gap-1 overflow-x-auto border-b px-3 py-2 md:hidden"
          style={{ borderColor: "var(--line-soft)", background: "color-mix(in oklab, var(--bg) 92%, transparent)", backdropFilter: "blur(8px)" }}
        >
          {NAV.slice(0, 7).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="whitespace-nowrap rounded-full px-3 py-1 text-[12px]"
              style={{
                background: isActive(item.href) ? "var(--panel-2)" : "transparent",
                color: isActive(item.href) ? "var(--fg)" : "var(--muted)",
              }}
            >
              {item.label}
            </Link>
          ))}
          <ThemeToggle className="ml-auto" />
        </nav>

        <main className={wide ? "min-w-0 flex-1" : "mx-auto w-full max-w-[720px] min-w-0 flex-1 px-5 py-8 md:py-12"}>
          {children}
        </main>

        <footer className="hidden pb-4 pt-2 md:block">
          <p className="px-6 text-center">
            <span className="mono text-[10px]" style={{ color: "var(--muted-2)" }}>
              ⌘K palette · N write · S search · ⌘↩ save
            </span>
          </p>
        </footer>
      </div>
    </div>
  );
}
