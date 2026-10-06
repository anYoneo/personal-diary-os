"use client";

import { useState } from "react";
import { api } from "@/lib/client";

/**
 * Invite management for the instance operator.
 *
 * The codes exist so this server stays closed: an unrestricted /register would
 * let anyone who found the URL write into it. Minting them used to require a
 * terminal on the server, which made a simple human task into an ops task — so
 * the operator gets this panel instead. It renders only for the operator; the
 * API refuses anyone else regardless (requireBetaAdmin).
 */
type Invite = {
  id: string;
  code: string;
  note: string | null;
  maxUses: number;
  usedCount: number;
  expiresAt: string | null;
};

function describe(inv: Invite): string {
  if (inv.usedCount >= inv.maxUses) return "used";
  if (inv.expiresAt && new Date(inv.expiresAt).getTime() < Date.now()) return "expired";
  return "active";
}

export function InvitePanel({ initial, origin }: { initial: Invite[]; origin: string }) {
  const [invites, setInvites] = useState<Invite[]>(initial);
  const [note, setNote] = useState("");
  const [days, setDays] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function mint(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const created = await api<{ code: string }>("/api/invites", {
        method: "POST",
        body: {
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(days.trim() ? { expiresInDays: Number(days) } : {}),
        },
      });
      setFresh(created.code);
      setNote("");
      setDays("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the code.");
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    const res = await api<{ codes: Invite[] }>("/api/invites");
    setInvites(res.codes);
  }

  async function revoke(code: string) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/invites?code=${encodeURIComponent(code)}`, { method: "DELETE" });
      if (fresh === code) setFresh(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke the code.");
    } finally {
      setBusy(false);
    }
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setError("Could not copy — select the code and copy it manually.");
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--muted)" }}>
        Send someone the link <code className="mono">{`${origin}/register`}</code> plus one of these
        codes. A code works once and can be revoked at any time. Each person who joins gets their own
        private diary — they cannot see yours, and you cannot see theirs.
      </p>

      {fresh ? (
        <div
          className="rounded-[10px] border px-4 py-3"
          style={{
            borderColor: "color-mix(in oklab, var(--accent) 40%, var(--line))",
            background: "color-mix(in oklab, var(--accent) 8%, transparent)",
          }}
        >
          <p className="label mb-1.5">New code — copy it now</p>
          <div className="flex items-center gap-3">
            <code className="mono text-[18px] tracking-[0.15em]" style={{ color: "var(--fg)" }}>
              {fresh}
            </code>
            <button type="button" onClick={() => copy(fresh)} className="btn btn-sm">
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-2 text-[11.5px]" style={{ color: "var(--muted)", fontSize: "11.5px" }}>
            It stays in the list below too, so you can look it up later.
          </p>
        </div>
      ) : null}

      <form onSubmit={mint} className="flex flex-wrap items-end gap-2">
        <div className="min-w-[160px] flex-1">
          <label htmlFor="invite-note" className="label mb-1.5 block">
            Who is it for <span style={{ color: "var(--muted)" }}>(optional)</span>
          </label>
          <input
            id="invite-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="input"
            placeholder="e.g. Rina"
            maxLength={120}
          />
        </div>
        <div className="w-[120px]">
          <label htmlFor="invite-days" className="label mb-1.5 block">
            Expires in
          </label>
          <input
            id="invite-days"
            value={days}
            onChange={(e) => setDays(e.target.value.replace(/[^0-9]/g, ""))}
            className="input"
            placeholder="days"
            inputMode="numeric"
          />
        </div>
        <button type="submit" disabled={busy} className="btn btn-primary">
          {busy ? "Working…" : "New code"}
        </button>
      </form>

      {error ? (
        <p className="text-[12.5px]" style={{ color: "var(--danger, #f87171)" }}>
          {error}
        </p>
      ) : null}

      {invites.length ? (
        <ul className="divide-y" style={{ borderColor: "var(--line-soft)" }}>
          {invites.map((inv) => {
            const state = describe(inv);
            return (
              <li key={inv.id} className="flex items-center gap-3 py-2.5">
                <code className="mono text-[13.5px] tracking-wider" style={{ color: "var(--fg)" }}>
                  {inv.code}
                </code>
                <span
                  className="label"
                  style={{
                    color:
                      state === "active"
                        ? "var(--muted)"
                        : state === "used"
                          ? "var(--muted-2)"
                          : "var(--danger, #f87171)",
                  }}
                >
                  {state}
                  {inv.maxUses > 1 ? ` · ${inv.usedCount}/${inv.maxUses}` : ""}
                  {inv.note ? ` · ${inv.note}` : ""}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => revoke(inv.code)}
                  className="btn btn-sm ml-auto"
                  title="Revoke this code"
                >
                  Revoke
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[12.5px]" style={{ color: "var(--muted-2)" }}>
          No codes yet.
        </p>
      )}
    </div>
  );
}
