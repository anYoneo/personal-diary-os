"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";

/** Creating a thread is four fields and a button — no wizard, no modal chain. */
export function ThreadForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("topic");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn">
        + New thread
      </button>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/threads", {
        method: "POST",
        body: { name, kind, description: description || null },
      });
      setName("");
      setDescription("");
      setKind("topic");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create thread.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="panel px-4 py-4">
      <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
        <div>
          <label htmlFor="thread-name" className="label mb-1.5 block">
            Name
          </label>
          <input
            id="thread-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Career, Health, Credit limit project…"
            className="input"
            autoFocus
            required
          />
        </div>
        <div>
          <label htmlFor="thread-kind" className="label mb-1.5 block">
            Kind
          </label>
          <select id="thread-kind" value={kind} onChange={(e) => setKind(e.target.value)} className="input">
            <option value="life">life area</option>
            <option value="project">project</option>
            <option value="person">person</option>
            <option value="place">place</option>
            <option value="topic">topic</option>
          </select>
        </div>
      </div>

      <div className="mt-3">
        <label htmlFor="thread-desc" className="label mb-1.5 block">
          Note (optional)
        </label>
        <input
          id="thread-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What this thread is about"
          className="input"
        />
      </div>

      {error ? (
        <p className="fade mt-3 text-[12.5px]" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={busy} className="btn btn-accent">
          {busy ? "Creating…" : "Create thread"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost">
          Cancel
        </button>
      </div>
    </form>
  );
}
