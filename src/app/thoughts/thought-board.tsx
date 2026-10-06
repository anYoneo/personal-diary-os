"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";

export type Thought = {
  id: string;
  question: string;
  note: string | null;
  status: string;
  createdDay: string;
  ageDays: number;
  firstMention: { id: string; day: string } | null;
  lastMention: { id: string; day: string } | null;
  updatedLabel: string;
  resolvedNote: string | null;
  createdLabel: string;
};

export function ThoughtBoard({ open, closed }: { open: Thought[]; closed: Thought[] }) {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showClosed, setShowClosed] = useState(false);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!question.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/thoughts", { method: "POST", body: { question, note: note || null } });
      setQuestion("");
      setNote("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: "open" | "resolved" | "dropped", resolvedNote?: string) {
    await api("/api/thoughts", {
      method: "PATCH",
      body: { id, status, resolvedNote: resolvedNote ?? null },
    });
    router.refresh();
  }

  async function remove(id: string) {
    await api(`/api/thoughts?id=${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div>
      <form onSubmit={add} className="panel px-4 py-4">
        <label htmlFor="thought" className="label mb-1.5 block">
          What&apos;s unresolved?
        </label>
        <input
          id="thought"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. Should I stay on the ERP project or move to the data team?"
          className="input"
          required
          maxLength={400}
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Context (optional)"
          className="input mt-2"
        />
        {error ? (
          <p className="fade mt-2 text-[12.5px]" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={busy} className="btn btn-accent mt-3">
          {busy ? "Saving…" : "Mark as unresolved"}
        </button>
      </form>

      {open.length ? (
        <ul className="stagger mt-7 space-y-2.5">
          {open.map((thought) => (
            <li key={thought.id} className="panel px-4 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-serif text-[16.5px] leading-snug" style={{ color: "var(--fg)" }}>
                  {thought.question}
                </p>
                <span className="mono shrink-0 text-[10px]" style={{ color: "var(--muted-2)" }}>
                  open {thought.ageDays} {thought.ageDays === 1 ? "day" : "days"}
                </span>
              </div>

              {thought.note ? (
                <p className="mt-1.5 text-[12.5px] leading-relaxed" style={{ color: "var(--muted)" }}>
                  {thought.note}
                </p>
              ) : null}

              <div className="mono mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]" style={{ color: "var(--muted-2)" }}>
                <span>raised {thought.createdLabel}</span>
                {thought.firstMention ? (
                  <Link href={`/entry/${thought.firstMention.id}`} className="underline">
                    first mention {thought.firstMention.day}
                  </Link>
                ) : null}
                {thought.lastMention ? (
                  <Link href={`/entry/${thought.lastMention.id}`} className="underline">
                    last {thought.lastMention.day}
                  </Link>
                ) : null}
                <span>touched {thought.updatedLabel}</span>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <ResolveButton onResolve={(note) => setStatus(thought.id, "resolved", note)} />
                <button type="button" onClick={() => void setStatus(thought.id, "dropped")} className="btn btn-ghost !py-1 text-[11.5px]">
                  Let it go
                </button>
                <button type="button" onClick={() => void remove(thought.id)} className="btn btn-ghost btn-danger !py-1 text-[11.5px]">
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="panel mt-7 px-5 py-9 text-center">
          <p className="font-serif text-[16px]" style={{ color: "var(--fg-2)" }}>
            Nothing open.
          </p>
          <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>
            When something keeps circling in your writing, park it here. Coming back to a question six
            months later is where this pays off.
          </p>
        </div>
      )}

      {closed.length ? (
        <section className="mt-9">
          <button
            type="button"
            onClick={() => setShowClosed((v) => !v)}
            className="label transition-colors"
            style={{ color: showClosed ? "var(--fg-2)" : "var(--muted-2)" }}
          >
            {showClosed ? "▾" : "▸"} settled & let go ({closed.length})
          </button>

          {showClosed ? (
            <ul className="mt-3 space-y-2">
              {closed.map((thought) => (
                <li key={thought.id} className="panel px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-[14px]" style={{ color: "var(--fg-2)" }}>
                      {thought.question}
                    </p>
                    <span className="mono text-[10px]" style={{ color: thought.status === "resolved" ? "var(--ok)" : "var(--muted-2)" }}>
                      {thought.status}
                    </span>
                  </div>
                  {thought.resolvedNote ? (
                    <p className="mt-1 text-[12.5px]" style={{ color: "var(--muted)" }}>
                      {thought.resolvedNote}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void setStatus(thought.id, "open")}
                    className="mono mt-2 text-[11px] underline"
                    style={{ color: "var(--muted-2)" }}
                  >
                    reopen
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function ResolveButton({ onResolve }: { onResolve: (note: string) => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn-accent !py-1 text-[11.5px]">
        Resolve
      </button>
    );
  }

  return (
    <span className="flex w-full flex-wrap items-center gap-2">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="How did it land?"
        className="input !w-auto flex-1 !py-1 !text-[12px]"
      />
      <button
        type="button"
        onClick={() => onResolve(note)}
        className="btn btn-accent !py-1 text-[11.5px]"
      >
        Save
      </button>
      <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost !py-1 text-[11.5px]">
        Cancel
      </button>
    </span>
  );
}
