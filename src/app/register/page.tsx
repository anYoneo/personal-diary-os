"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/client";

/**
 * Invite-only registration. Without a valid code from the operator this page
 * cannot create an account — the app holds someone's private diary, so an open
 * sign-up form would be an open door.
 */
export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", password: "", inviteCode: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set(key: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/register", { method: "POST", body: form });
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the account.");
      setBusy(false);
    }
  }

  return (
    <main className="relative z-10 flex min-h-screen items-center justify-center px-5 py-12">
      <div className="w-full max-w-[380px]">
        <div className="rise">
          <p className="label mb-3">Invite only</p>
          <h1 className="font-serif text-[30px] leading-tight" style={{ color: "var(--fg)" }}>
            Start your own journal.
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>
            Your entries are private to your account — the person who invited you cannot read them
            from the app, and neither can anyone else here. Whoever runs this server does hold the
            database file, so treat this as a private journal, not an encrypted one.
          </p>
        </div>

        <form onSubmit={submit} className="rise mt-8 space-y-3" style={{ animationDelay: "80ms" }}>
          <div>
            <label htmlFor="inviteCode" className="label mb-1.5 block">
              Invite code
            </label>
            <input
              id="inviteCode"
              required
              value={form.inviteCode}
              onChange={set("inviteCode")}
              className="input font-mono tracking-wider"
              placeholder="ABCD-EFGH"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div>
            <label htmlFor="name" className="label mb-1.5 block">
              Name <span style={{ color: "var(--muted)" }}>(optional)</span>
            </label>
            <input id="name" value={form.name} onChange={set("name")} className="input" placeholder="What should we call you?" />
          </div>

          <div>
            <label htmlFor="email" className="label mb-1.5 block">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="username"
              value={form.email}
              onChange={set("email")}
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
              required
              minLength={8}
              autoComplete="new-password"
              value={form.password}
              onChange={set("password")}
              className="input"
              placeholder="At least 8 characters"
            />
          </div>

          {error ? (
            <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--danger, #f87171)" }}>
              {error}
            </p>
          ) : null}

          <button type="submit" disabled={busy} className="btn btn-primary w-full">
            {busy ? "Creating…" : "Create my journal"}
          </button>
        </form>

        <p className="rise mt-6 text-[12.5px]" style={{ color: "var(--muted)", animationDelay: "160ms" }}>
          Already have an account?{" "}
          <Link href="/login" className="underline">
            Sign in
          </Link>
        </p>

        <p className="rise mt-4 text-[12px] leading-relaxed" style={{ color: "var(--muted-2)", animationDelay: "160ms" }}>
          If there are no notifications yet: this server sends Discord reminders for the person who
          runs it. Your own reminders are saved and shown here in the app, but not pushed anywhere.
        </p>
      </div>
    </main>
  );
}
