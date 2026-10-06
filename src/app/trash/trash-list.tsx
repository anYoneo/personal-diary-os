"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";

type TrashEntry = {
  id: string;
  day: string;
  title: string;
  excerpt: string;
  wordCount: number;
  deletedAt: string | null;
};

export function TrashList({ entries }: { entries: TrashEntry[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmPurge, setConfirmPurge] = useState<string | null>(null);

  async function restore(id: string) {
    setBusy(id);
    try {
      await api(`/api/entries/${id}`, { method: "POST" });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function purge(id: string) {
    setBusy(id);
    try {
      await api(`/api/entries/${id}?hard=true`, { method: "DELETE" });
      setConfirmPurge(null);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <ul className="stagger space-y-2.5">
      {entries.map((entry) => (
        <li key={entry.id} className="panel px-4 py-3.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-serif text-[15px]" style={{ color: "var(--fg-2)" }}>
              {entry.title}
            </span>
            <span className="mono shrink-0 text-[10px]" style={{ color: "var(--muted-2)" }}>
              {entry.day} · {entry.wordCount}w
            </span>
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed" style={{ color: "var(--muted)" }}>
            {entry.excerpt}
          </p>
          {entry.deletedAt ? (
            <p className="mono mt-1.5 text-[10px]" style={{ color: "var(--muted-2)" }}>
              deleted {entry.deletedAt.slice(0, 16).replace("T", " ")}
            </p>
          ) : null}

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy === entry.id}
              onClick={() => void restore(entry.id)}
              className="btn btn-accent !py-1 text-[11.5px]"
            >
              {busy === entry.id ? "…" : "Restore"}
            </button>

            {confirmPurge === entry.id ? (
              <>
                <span className="mono text-[10.5px]" style={{ color: "var(--danger)" }}>
                  erase permanently?
                </span>
                <button
                  type="button"
                  disabled={busy === entry.id}
                  onClick={() => void purge(entry.id)}
                  className="btn btn-danger !py-1 text-[11.5px]"
                >
                  Yes, purge
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmPurge(null)}
                  className="btn btn-ghost !py-1 text-[11.5px]"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmPurge(entry.id)}
                className="btn btn-ghost btn-danger !py-1 text-[11.5px]"
              >
                Purge
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
