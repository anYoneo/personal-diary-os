"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";

export type Goal = {
  id: string;
  title: string;
  detail: string | null;
  status: string;
  thread: { id: string; name: string; slug: string } | null;
  targetDate: string | null;
  completedDay: string | null;
  createdDay: string;
  sourceEntry: { id: string; day: string } | null;
};

export function GoalBoard({
  goals,
  threads,
}: {
  goals: Goal[];
  threads: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [threadId, setThreadId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = goals.filter((g) => g.status === "open");
  const done = goals.filter((g) => g.status === "done");
  const dropped = goals.filter((g) => g.status === "dropped");

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/goals", {
        method: "POST",
        body: { title, detail: detail || null, threadId: threadId || null },
      });
      setTitle("");
      setDetail("");
      setThreadId("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the goal.");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: "open" | "done" | "dropped") {
    await api(`/api/goals/${id}`, { method: "PATCH", body: { status } });
    router.refresh();
  }

  return (
    <div>
      <form onSubmit={add} className="panel px-4 py-4">
        <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
          <div>
            <label htmlFor="goal-title" className="label mb-1.5 block">
              Goal
            </label>
            <input
              id="goal-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Learn TOGAF, finish the migration, run 10k"
              className="input"
              required
              maxLength={200}
            />
          </div>
          <div>
            <label htmlFor="goal-thread" className="label mb-1.5 block">
              Thread (optional)
            </label>
            <select
              id="goal-thread"
              value={threadId}
              onChange={(e) => setThreadId(e.target.value)}
              className="input"
            >
              <option value="">— none —</option>
              {threads.map((thread) => (
                <option key={thread.id} value={thread.id}>
                  {thread.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <input
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          placeholder="Why it matters (optional)"
          className="input mt-2"
        />
        {error ? (
          <p className="fade mt-2 text-[12.5px]" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={busy} className="btn btn-accent mt-3">
          {busy ? "Saving…" : "Add goal"}
        </button>
      </form>

      <Group title={`Open (${open.length})`} goals={open} onStatus={setStatus} />

      {done.length ? <Group title={`Done (${done.length})`} goals={done} onStatus={setStatus} done /> : null}
      {dropped.length ? <Group title={`Dropped (${dropped.length})`} goals={dropped} onStatus={setStatus} muted /> : null}

      {goals.length === 0 ? (
        <div className="panel mt-7 px-5 py-9 text-center">
          <p className="font-serif text-[16px]" style={{ color: "var(--fg-2)" }}>
            No goals yet.
          </p>
          <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>
            Add one above, or start an entry with <code className="mono">goal:</code> in Discord and it
            lands here as a discussion topic.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Group({
  title,
  goals,
  onStatus,
  done = false,
  muted = false,
}: {
  title: string;
  goals: Goal[];
  onStatus: (id: string, status: "open" | "done" | "dropped") => void;
  done?: boolean;
  muted?: boolean;
}) {
  if (!goals.length) return null;

  return (
    <section className="mt-7">
      <h2 className="label mb-3">{title}</h2>
      <ul className="stagger space-y-2">
        {goals.map((goal) => (
          <li key={goal.id} className="panel px-4 py-3.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span
                className="text-[14.5px]"
                style={{
                  color: muted ? "var(--muted-2)" : done ? "var(--muted)" : "var(--fg)",
                  textDecoration: done ? "line-through" : "none",
                  textDecorationColor: "var(--muted-2)",
                }}
              >
                {goal.title}
              </span>
              <span className="flex items-center gap-2">
                {goal.thread ? (
                  <Link href={`/threads?slug=${goal.thread.slug}`} className="tag-pill">
                    {goal.thread.name}
                  </Link>
                ) : null}
                {goal.completedDay ? (
                  <span className="mono text-[10px]" style={{ color: "var(--ok)" }}>
                    {goal.completedDay}
                  </span>
                ) : null}
              </span>
            </div>

            {goal.detail ? (
              <p className="mt-1 text-[12.5px] leading-relaxed" style={{ color: "var(--muted)" }}>
                {goal.detail}
              </p>
            ) : null}

            <div className="mono mt-2 flex flex-wrap items-center gap-3 text-[10px]" style={{ color: "var(--muted-2)" }}>
              <span>added {goal.createdDay}</span>
              {goal.targetDate ? <span>target {goal.targetDate}</span> : null}
              {goal.sourceEntry ? (
                <Link href={`/entry/${goal.sourceEntry.id}`} className="underline">
                  from entry {goal.sourceEntry.day}
                </Link>
              ) : null}
            </div>

            <div className="mt-2.5 flex gap-2">
              {goal.status === "open" ? (
                <>
                  <button type="button" onClick={() => onStatus(goal.id, "done")} className="btn btn-accent !py-1 text-[11.5px]">
                    Mark done
                  </button>
                  <button type="button" onClick={() => onStatus(goal.id, "dropped")} className="btn btn-ghost !py-1 text-[11.5px]">
                    Drop it
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => onStatus(goal.id, "open")} className="btn btn-ghost !py-1 text-[11.5px]">
                  Reopen
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
