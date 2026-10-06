"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "@/lib/client";
import { createSaveQueue } from "@/lib/save-queue";
import {
  clearDraft,
  draftHasNewerWriting,
  readDraft,
  type DraftStorage,
  writeDraft,
} from "@/lib/draft";
import { countWords, readingTimeMinutes } from "@/lib/markdown";
import { ENTRY_TYPES, MOODS } from "@/lib/validation";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "offline" | "error";

export type EditorEntry = {
  id?: string;
  title: string | null;
  content: string;
  entryType: string;
  mood: string | null;
  occurredAt: string; // ISO
  location: string | null;
  isImportant: boolean;
  tags: string[];
  threads: { id: string; name: string }[];
  version?: number;
};

type ThreadOption = { id: string; name: string };

/** Everything the save path sends; one payload describes one complete state. */
type SavePayload = Pick<
  EditorEntry,
  "content" | "title" | "entryType" | "mood" | "occurredAt" | "location" | "isImportant" | "tags" | "threads"
>;

function payloadFrom(entry: EditorEntry): SavePayload {
  return {
    content: entry.content,
    title: entry.title,
    entryType: entry.entryType,
    mood: entry.mood,
    occurredAt: entry.occurredAt,
    location: entry.location,
    isImportant: entry.isImportant,
    tags: entry.tags,
    threads: entry.threads,
  };
}

/**
 * Whole-state save: the later payload already describes everything the earlier
 * one did (these are complete snapshots, not field patches), so the newest wins.
 */
function newerPayload(_previous: SavePayload, next: SavePayload): SavePayload {
  return next;
}

/**
 * Share the newest known version with the user's other tabs, so a background tab
 * can catch up instead of having its next save rejected as a conflict.
 */
function publishVersion(entryId: string, version: number): void {
  if (typeof window === "undefined") return;
  try {
    const key = VERSION_KEY;
    const shared = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, number>;
    shared[entryId] = Math.max(shared[entryId] ?? 0, version);
    localStorage.setItem(key, JSON.stringify(shared));
  } catch {
    /* private mode, quota — the editor works fine without this */
  }
}

/**
 * Highest version this browser has seen per entry, shared across tabs.
 *
 * The editor opens with the version the page was rendered with. If another tab
 * saves first, this tab's version is stale and its next save is rejected as a
 * conflict — which is a confusing lie, since nobody else edited anything. This
 * broadcast lets a tab catch up silently instead of accusing the user.
 */
const VERSION_KEY = "diary.versions";

/** localStorage, or null where it is unavailable (SSR, private mode, tests). */
function liveStorage(): DraftStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The writing surface. Everything else in the app exists to get out of its way.
 *
 * Reliability rules — each one earned from a real failure:
 *  - every keystroke is mirrored to localStorage, for new entries AND for saved
 *    ones, keyed by entry id. The mirror used to stop the moment a draft got an
 *    id, so text written after the first autosave existed only in React state
 *    and vanished if a later save was refused;
 *  - saves read from refs, never from a render's `entry`, so a save in flight
 *    cannot put stale text back over what has been typed since;
 *  - at most one save is in flight (see lib/save-queue.ts): the 900 ms debounce
 *    and the Save button used to overlap carrying the same version, and the
 *    server correctly refused the second — after which the editor latched into a
 *    conflict and Save appeared dead;
 *  - a version mismatch keeps the local text and asks, rather than clobbering,
 *    and the local copy survives "reload the server version".
 */
export function Editor({
  initial,
  threads,
  autoFocus = true,
}: {
  initial: EditorEntry;
  threads: ThreadOption[];
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const [entry, setEntry] = useState<EditorEntry>(initial);
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  /** Mirrors `conflict` for callbacks that must not re-create on every toggle. */
  const conflictRef = useRef(false);
  const [preview, setPreview] = useState(false);
  const [related, setRelated] = useState<
    { id: string; day: string; title: string | null; excerpt: string; reason: string }[]
  >([]);
  const [tagInput, setTagInput] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  /** A draft found on this device that the server does not have. */
  const [restored, setRestored] = useState<{ at: string } | null>(null);

  const idRef = useRef<string | undefined>(initial.id);
  /** Mirrors idRef for rendering — a ref must never be read during render. */
  const [entryId, setEntryId] = useState<string | undefined>(initial.id);
  const versionRef = useRef<number>(initial.version ?? 0);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /**
   * Latest known editor state, for callbacks that must not be re-created on every
   * keystroke. `persist` used to close over `entry`, so each change built a new
   * callback (and a new save queue) — the very thing that let two saves overlap.
   */
  const entryRef = useRef<EditorEntry>(initial);

  const words = useMemo(() => countWords(entry.content), [entry.content]);
  const minutes = useMemo(() => readingTimeMinutes(entry.content), [entry.content]);

  /**
   * Related memories for the entry being edited. Declared before `persist`
   * because persist calls it; a plain function would be hoisted but the
   * linter's ordering rule wants it explicit.
   */
  const loadRelated = useCallback(async (id: string) => {
    try {
      const result = await api<{
        related: { id: string; day: string; title: string | null; excerpt: string; reason: string }[];
      }>(`/api/entries/${id}?action=related`, { method: "POST" });
      setRelated(result.related);
    } catch {
      // Related memories are a bonus; never surface an error for them.
    }
  }, []);

  /** Restore an unsaved draft after a crash, a refused save, or an accidental close. */
  useEffect(() => {
    const draft = readDraft(liveStorage(), idRef.current);
    // Only for an existing entry: a draft left over from a *different* entry must
    // never be poured into this one.
    if (idRef.current && draft?.id !== idRef.current) return;
    if (!draftHasNewerWriting(draft, entryRef.current) || !draft) return;
    // Deferred by a microtask so this is not a synchronous cascading render.
    queueMicrotask(() => {
      const next = { ...entryRef.current, content: draft.content, title: draft.title ?? entryRef.current.title };
      entryRef.current = next;
      setEntry(next);
      setState("dirty");
      setRestored({ at: draft.at });
    });
  }, []);

  /** The actual network send. Serialised by the save queue below. */
  const send = useCallback(
    async (patch: SavePayload) => {
      setState("saving");
      setError(null);

      const body: Record<string, unknown> = { ...patch };
      if (idRef.current) body.expectedVersion = versionRef.current;

      try {
        if (idRef.current) {
          const result = await api<{ version: number; updatedAt: string }>(
            `/api/entries/${idRef.current}`,
            { method: "PATCH", body },
          );
          versionRef.current = result.version;
          publishVersion(idRef.current, result.version);
          setSavedAt(result.updatedAt);
        } else {
          const current = entryRef.current;
          const created = await api<{ id: string; version: number }>("/api/entries", {
            method: "POST",
            body: {
              content: patch.content ?? current.content,
              title: patch.title ?? current.title,
              entryType: patch.entryType ?? current.entryType,
              mood: patch.mood ?? current.mood,
              occurredAt: patch.occurredAt ?? current.occurredAt,
              location: patch.location ?? current.location,
              isImportant: patch.isImportant ?? current.isImportant,
              tags: patch.tags ?? current.tags,
              threadIds: (patch.threads ?? current.threads).map((t) => t.id),
              source: "web",
            },
          });
          idRef.current = created.id;
          setEntryId(created.id);
          versionRef.current = created.version;
          publishVersion(created.id, created.version);
          // The draft has an id now, so it moves from the single new-entry slot to
          // the per-entry one — the mirror must keep going, not stop here.
          clearDraft(liveStorage(), null);
          clearDraft(liveStorage(), created.id);
          // Swap the URL without losing editor state.
          window.history.replaceState(null, "", `/entry/${created.id}`);
        }

        dirtyRef.current = false;
        setState("saved");
        setRestored(null);
        // The server now holds exactly what this device holds, so the safety-net
        // copy has served its purpose and must not reappear as a stale draft.
        clearDraft(liveStorage(), idRef.current);
        router.refresh();
        if (idRef.current) void loadRelated(idRef.current);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not save.";
        if (message.toLowerCase().includes("changed since you opened")) {
          conflictRef.current = true;
          setConflict(true);
          setState("error");
          setError(message);
        } else if (typeof navigator !== "undefined" && !navigator.onLine) {
          setState("offline");
        } else {
          setState("error");
          setError(message);
        }
        throw err;
      }
    },
    [loadRelated, router],
  );

  /**
   * One queue per mounted editor, built on first use (never during render — the
   * React lint rule forbids reading refs there). Because `send` is stable, the
   * queue is built once, so the debounce and the Save button can never be in
   * flight together with the same version — the bug that made a save look like it
   * ate text and then refused every later attempt.
   */
  const queueRef = useRef<ReturnType<typeof createSaveQueue<SavePayload>> | null>(null);
  const getQueue = useCallback(() => {
    if (!queueRef.current) {
      queueRef.current = createSaveQueue<SavePayload>((payload) => send(payload), newerPayload);
    }
    return queueRef.current;
  }, [send]);

  const persist = useCallback(
    (patch: SavePayload) => {
      if (conflictRef.current) return;
      getQueue()
        .push(patch)
        .catch(() => {
          // Already reflected in `state` by `send`; the text stays in the editor
          // and in localStorage, so nothing is lost and the user can retry.
        });
    },
    [getQueue],
  );

  const schedule = useCallback(
    (patch: SavePayload) => {
      dirtyRef.current = true;
      setState("dirty");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void persist(patch);
      }, 900);
    },
    [persist],
  );

  const update = (patch: Partial<EditorEntry>) => {
    // Derived from the ref, not from a functional state update: the ref is always
    // current, so Save can rely on it and the payload cannot lag a render behind.
    const next = { ...entryRef.current, ...patch };
    entryRef.current = next;
    setEntry(next);
    // Mirrored on every keystroke, whether or not the entry has an id yet. This
    // is the safety net for a refused save, a dropped connection, a crash or a
    // closed tab — the thing that did not exist when text was lost.
    if (patch.content !== undefined || patch.title !== undefined) {
      writeDraft(liveStorage(), {
        id: idRef.current ?? null,
        content: next.content,
        title: next.title,
        at: new Date().toISOString(),
      });
    }
    schedule(next);
  };

  /**
   * Force a save now (⌘/Ctrl+Enter, or clicking the indicator).
   *
   * Reads the refs, not the render's `entry`: clicking Save must send what the
   * textarea currently holds, including keystrokes from the last 900 ms that the
   * debounce has not flushed yet.
   */
  const saveNow = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (conflictRef.current) {
      // The queue hot-potatoes a save it already rejected, so retrying is safe
      // once the user acknowledges the conflict.
      return;
    }
    await persist(payloadFrom(entryRef.current));
  }, [persist]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void saveNow();
      }
      if (event.key === "Escape" && preview) setPreview(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview, saveNow]);

  /**
   * If another tab adopted a new version while this one sat idle, our cached
   * version is stale and the server would refuse the next save as a bogus
   * "someone else changed this". Adopt theirs instead — same user, same entry.
   */
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== VERSION_KEY || !idRef.current) return;
      try {
        const shared = JSON.parse(event.newValue ?? "{}") as Record<string, number>;
        const theirs = shared[idRef.current];
        if (typeof theirs === "number" && theirs > versionRef.current) {
          versionRef.current = theirs;
        }
      } catch {
        /* a corrupt value must never break the editor */
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  const addTag = () => {
    const tag = tagInput.trim().replace(/^#/, "").toLowerCase();
    if (!tag || entry.tags.includes(tag)) {
      setTagInput("");
      return;
    }
    update({ tags: [...entry.tags, tag] });
    setTagInput("");
  };

  const toggleThread = (thread: ThreadOption) => {
    const has = entry.threads.some((t) => t.id === thread.id);
    update({
      threads: has ? entry.threads.filter((t) => t.id !== thread.id) : [...entry.threads, thread],
    });
  };

  const saveStateLabel: Record<SaveState, string> = {
    idle: initial.id ? "Saved" : "Draft",
    dirty: "Unsaved changes",
    saving: "Saving…",
    saved: "Saved",
    offline: "Offline — stored locally",
    error: "Save failed",
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="label">
            {new Date(entry.occurredAt).toLocaleString("en-GB", {
              weekday: "short",
              day: "2-digit",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          <span aria-hidden style={{ color: "var(--muted-2)" }}>
            ·
          </span>
          <span className="mono text-[10px]" style={{ color: "var(--muted-2)" }}>
            {words} {words === 1 ? "word" : "words"}
            {minutes > 0 ? ` · ${minutes} min read` : ""}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPreview((v) => !v)}
            className="btn btn-ghost"
            title="Toggle preview (Esc to close)"
          >
            {preview ? "Write" : "Preview"}
          </button>
          <button
            type="button"
            onClick={() => void saveNow()}
            disabled={state === "saving"}
            className="btn"
            title="⌘/Ctrl + Enter"
          >
            Save
          </button>
        </div>
      </header>

      <div className="save-bar mt-3" data-state={state} />
      <div className="mt-1.5 flex h-5 items-center justify-between">
        <span
          className="mono flex items-center gap-2 text-[10px]"
          style={{
            color:
              state === "error"
                ? "var(--danger)"
                : state === "offline"
                  ? "var(--info)"
                  : state === "saved"
                    ? "var(--ok)"
                    : "var(--muted-2)",
          }}
        >
          {state === "saving" ? <span className="save-dot" /> : null}
          {saveStateLabel[state]}
        </span>
        {savedAt ? (
          <span className="mono text-[10px]" style={{ color: "var(--muted-2)" }}>
            {new Date(savedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
        ) : null}
      </div>

      {error ? (
        <div
          className="fade mt-3 rounded-[8px] border px-3 py-2.5 text-[12.5px]"
          style={{
            borderColor: conflict ? "var(--accent-line)" : "color-mix(in oklab, var(--danger) 40%, var(--line))",
            color: conflict ? "var(--fg-2)" : "var(--danger)",
            background: conflict ? "var(--accent-soft)" : "color-mix(in oklab, var(--danger) 8%, transparent)",
          }}
        >
          {error}
          {conflict ? (
            <button
              type="button"
              onClick={async () => {
                // Pull the server's copy and adopt its version. Clearing the flag
                // alone used to leave versionRef stale, so every later save was
                // rejected again and the page looked permanently broken — the
                // only way out was a full reload.
                try {
                  const fresh = await api<{
                    content: string;
                    title: string | null;
                    version: number;
                  }>(`/api/entries/${idRef.current}`);
                  versionRef.current = fresh.version;
                  // Discard this device's unsaved copy, so it cannot be restored
                  // straight back in and re-create the same conflict.
                  clearDraft(liveStorage(), idRef.current);
                  const merged = { ...entryRef.current, content: fresh.content, title: fresh.title };
                  entryRef.current = merged;
                  setEntry(merged);
                  setRestored(null);
                  dirtyRef.current = false;
                } catch {
                  router.refresh();
                }
                conflictRef.current = false;
                setConflict(false);
                setError(null);
                setState("idle");
              }}
              className="btn btn-ghost ml-2 !px-2 !py-0.5 text-[11px]"
            >
              Reload server version
            </button>
          ) : null}
        </div>
      ) : null}

      {restored ? (
        <div
          className="fade mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[8px] border px-3 py-2.5 text-[12.5px]"
          style={{ borderColor: "var(--line)", background: "var(--card)", color: "var(--fg-2)" }}
        >
          <span>
            Unsaved writing from this device was restored
            {restored.at !== new Date(0).toISOString()
              ? ` (${new Date(restored.at).toLocaleString("en-GB", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })})`
              : ""}
            .
          </span>
          <button
            type="button"
            onClick={() => {
              clearDraft(liveStorage(), idRef.current);
              const reset = { ...entryRef.current, content: initial.content, title: initial.title };
              entryRef.current = reset;
              setEntry(reset);
              setRestored(null);
              setState("idle");
            }}
            className="btn btn-ghost !px-2 !py-0.5 text-[11px]"
          >
            Discard it
          </button>
        </div>
      ) : null}

      <input
        value={entry.title ?? ""}
        onChange={(e) => update({ title: e.target.value })}
        placeholder="Title (optional)"
        className="mt-6 w-full border-none bg-transparent font-serif text-[24px] outline-none"
        style={{ color: "var(--fg)" }}
      />

      {preview ? (
        <article className="prose-diary fade mt-4 min-h-[45vh]">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.content || "*Nothing to preview yet.*"}</ReactMarkdown>
        </article>
      ) : (
        <textarea
          ref={textareaRef}
          value={entry.content}
          onChange={(e) => update({ content: e.target.value })}
          placeholder="What's on your mind today?&#10;&#10;Markdown works: **bold**, - lists, `code`, > quotes, - [ ] tasks"
          spellCheck
          className="mt-2 min-h-[45vh] w-full flex-1 resize-none border-none bg-transparent text-[16.5px] leading-[1.75] outline-none"
          style={{ color: "var(--fg-2)", fontFamily: "var(--font-sans), ui-sans-serif" }}
        />
      )}

      <section className="mt-8 border-t pt-6" style={{ borderColor: "var(--line-soft)" }}>
        <div className="grid gap-6 md:grid-cols-2">
          <Field label="Type">
            <div className="flex flex-wrap gap-1.5">
              {ENTRY_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => update({ entryType: type })}
                  className="chip"
                  data-active={entry.entryType === type}
                >
                  {type}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Mood (optional)">
            <div className="flex flex-wrap gap-1.5">
              {MOODS.map((mood) => (
                <button
                  key={mood.key}
                  type="button"
                  onClick={() => update({ mood: entry.mood === mood.key ? null : mood.key })}
                  className="chip"
                  data-active={entry.mood === mood.key}
                  title={mood.label}
                >
                  <span aria-hidden>{mood.emoji}</span>
                  <span>{mood.label}</span>
                </button>
              ))}
            </div>
          </Field>

          <Field label="Tags">
            <div className="flex flex-wrap items-center gap-1.5">
              {entry.tags.map((tag) => (
                <span key={tag} className="chip" data-active="true">
                  #{tag}
                  <button
                    type="button"
                    aria-label={`Remove ${tag}`}
                    onClick={() => update({ tags: entry.tags.filter((t) => t !== tag) })}
                    className="ml-0.5"
                    style={{ color: "inherit" }}
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTag();
                  }
                  if (e.key === "Backspace" && !tagInput && entry.tags.length) {
                    update({ tags: entry.tags.slice(0, -1) });
                  }
                }}
                onBlur={addTag}
                placeholder={entry.tags.length ? "add…" : "add a tag"}
                className="w-24 bg-transparent text-[11px] outline-none"
                style={{ color: "var(--fg-2)" }}
              />
            </div>
          </Field>

          <Field label="Life threads">
            {threads.length ? (
              <div className="flex flex-wrap gap-1.5">
                {threads.map((thread) => (
                  <button
                    key={thread.id}
                    type="button"
                    onClick={() => toggleThread(thread)}
                    className="chip"
                    data-active={entry.threads.some((t) => t.id === thread.id)}
                  >
                    {thread.name}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[12px]" style={{ color: "var(--muted-2)" }}>
                No threads yet. <Link href="/threads" className="underline">Create one</Link> to track recurring
                subjects.
              </p>
            )}
          </Field>

          <Field label="When">
            <input
              type="datetime-local"
              value={toLocalInput(entry.occurredAt)}
              onChange={(e) => update({ occurredAt: new Date(e.target.value).toISOString() })}
              className="input"
            />
          </Field>

          <Field label="Where (optional)">
            <input
              value={entry.location ?? ""}
              onChange={(e) => update({ location: e.target.value })}
              placeholder="Home, office, Jakarta…"
              className="input"
            />
          </Field>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-[12.5px]" style={{ color: "var(--muted)" }}>
            <input
              type="checkbox"
              checked={entry.isImportant}
              onChange={(e) => update({ isImportant: e.target.checked })}
              className="accent-[var(--accent)]"
            />
            Mark as important
          </label>

          {entryId ? (
            <div className="flex items-center gap-2">
              <Link href={`/entry/${entryId}`} className="mono text-[11px]" style={{ color: "var(--muted-2)" }}>
                permalink
              </Link>
              <DeleteButton
                entryId={entryId}
                onDone={() => {
                  clearDraft(liveStorage(), entryId);
                  router.push("/timeline");
                  router.refresh();
                }}
              />
            </div>
          ) : null}
        </div>
      </section>

      {related.length ? (
        <section className="mt-8">
          <h2 className="label mb-3">You wrote about this before</h2>
          <div className="space-y-2">
            {related.map((item) => (
              <Link key={item.id} href={`/entry/${item.id}`} className="panel block px-3.5 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[13.5px]" style={{ color: "var(--fg)" }}>
                    {item.title?.trim() || item.excerpt.slice(0, 60)}
                  </span>
                  <span className="mono shrink-0 text-[10px]" style={{ color: "var(--muted-2)" }}>
                    {item.day}
                  </span>
                </div>
                <p className="mt-1 text-[12.5px] leading-relaxed" style={{ color: "var(--muted)" }}>
                  {item.excerpt.slice(0, 180)}
                </p>
                <p className="mono mt-1.5 text-[10px]" style={{ color: "var(--accent)" }}>
                  {item.reason}
                </p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="label mb-2">{label}</p>
      {children}
    </div>
  );
}

function DeleteButton({ entryId, onDone }: { entryId: string; onDone: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className="btn btn-ghost btn-danger !py-0.5 text-[11px]">
        Delete
      </button>
    );
  }

  return (
    <span className="flex items-center gap-1.5">
      <span className="mono text-[10px]" style={{ color: "var(--muted-2)" }}>
        move to trash?
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api(`/api/entries/${entryId}`, { method: "DELETE" });
            onDone();
          } finally {
            setBusy(false);
          }
        }}
        className="btn btn-danger !py-0.5 text-[11px]"
      >
        {busy ? "…" : "Yes"}
      </button>
      <button type="button" onClick={() => setConfirming(false)} className="btn btn-ghost !py-0.5 text-[11px]">
        No
      </button>
    </span>
  );
}

/** ISO → value for <input type="datetime-local"> in the viewer's timezone. */
function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}
