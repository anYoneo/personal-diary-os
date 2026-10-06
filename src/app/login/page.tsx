"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/client";

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/login", { method: "POST", body: { email, password } });
      const next = params.get("next");
      router.replace(next && next.startsWith("/") ? next : "/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed.");
      setBusy(false);
    }
  }

  return (
    <main className="relative z-10 flex min-h-screen items-center justify-center px-5">
      <div className="w-full max-w-[380px]">
        <div className="rise">
          <p className="label mb-3">Private journal</p>
          <h1 className="font-serif text-[30px] leading-tight" style={{ color: "var(--fg)" }}>
            Your place to think.
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>
            Everything you write stays in your own database. No feeds, no sharing, no audience.
          </p>
        </div>

        <form onSubmit={submit} className="rise mt-8 space-y-3" style={{ animationDelay: "80ms" }}>
          <div>
            <label htmlFor="email" className="label mb-1.5 block">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="label mb-1.5 block">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
              placeholder="••••••••"
            />
          </div>

          {error ? (
            <p
              role="alert"
              className="fade rounded-[8px] border px-3 py-2 text-[12.5px]"
              style={{
                borderColor: "color-mix(in oklab, var(--danger) 40%, var(--line))",
                color: "var(--danger)",
                background: "color-mix(in oklab, var(--danger) 8%, transparent)",
              }}
            >
              {error}
            </p>
          ) : null}

          <button type="submit" disabled={busy} className="btn btn-accent w-full">
            {busy ? "Signing in…" : "Enter"}
          </button>
        </form>

        <p className="mt-6 text-[11.5px] leading-relaxed" style={{ color: "var(--muted-2)" }}>
          Have an invite code?{" "}
          <Link href="/register" className="underline">
            Create your journal
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
