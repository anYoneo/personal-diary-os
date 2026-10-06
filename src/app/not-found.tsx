import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="font-mono text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
        404
      </p>
      <h1 className="text-2xl text-[var(--fg)]">This page isn&apos;t in your diary.</h1>
      <p className="max-w-sm text-sm text-[var(--muted)]">
        The entry may have been deleted, or the link is wrong.
      </p>
      <Link href="/" className="btn btn-accent mt-2">
        Back to today
      </Link>
    </main>
  );
}
