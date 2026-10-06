"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="font-mono text-xs uppercase tracking-[0.3em] text-[var(--danger)]">
        error
      </p>
      <h1 className="text-2xl text-[var(--fg)]">Something broke while reading your diary.</h1>
      <p className="max-w-md text-sm text-[var(--muted)]">
        Your writing is safe — nothing was lost. Try again; if it keeps happening, check
        the server logs.
        {error.digest ? (
          <span className="mt-2 block font-mono text-[11px] text-[var(--muted-2)]">
            ref {error.digest}
          </span>
        ) : null}
      </p>
      <button onClick={reset} className="btn btn-accent mt-2">
        Try again
      </button>
    </main>
  );
}
