/**
 * Local draft mirror for the editor.
 *
 * The editor used to persist a draft only while an entry was still new (no id
 * yet). Once the first autosave created the entry, the mirror stopped — so any
 * later text lived solely in React state. If the server then refused a save (a
 * version conflict, a dropped connection, a closed tab) that text was gone with
 * nothing to recover from, which is exactly what happened: a writer watched an
 * autosave land and part of their paragraph disappear.
 *
 * Now every keystroke is mirrored, keyed by the entry it belongs to. Writing
 * also does not depend on React state being current, so an in-flight save can
 * never blank the draft.
 *
 * Storage is injected rather than reaching for `window.localStorage` so this can
 * be unit-tested without a DOM, and so a failure (private mode, quota) can never
 * throw into the editor.
 */
export type EditorDraft = {
  id: string | null;
  content: string;
  title: string | null;
  /** ISO timestamp of the last local write — shown when a draft is restored. */
  at: string;
};

export const DRAFT_PREFIX = "diary.draft";

/** Keyed per entry, so editing one entry cannot overwrite another's draft. */
export function draftKey(id?: string | null): string {
  return id ? `${DRAFT_PREFIX}.${id}` : DRAFT_PREFIX;
}

export function parseDraft(raw: string | null): EditorDraft | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<EditorDraft>;
    if (typeof value?.content !== "string") return null;
    return {
      id: typeof value.id === "string" ? value.id : null,
      content: value.content,
      title: typeof value.title === "string" ? value.title : null,
      at: typeof value.at === "string" ? value.at : new Date(0).toISOString(),
    };
  } catch {
    // A corrupt draft must never block writing.
    return null;
  }
}

/**
 * Does this draft hold writing the server does not have?
 *
 * Whitespace-only drafts are ignored: they would otherwise resurrect an empty
 * editor with a "restored" notice, which reads as a bug.
 */
export function draftHasNewerWriting(
  draft: EditorDraft | null,
  server: { content: string },
): boolean {
  if (!draft) return false;
  if (!draft.content.trim()) return false;
  return draft.content !== server.content;
}

export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function readDraft(storage: DraftStorage | null, id?: string | null): EditorDraft | null {
  if (!storage) return null;
  try {
    return parseDraft(storage.getItem(draftKey(id)));
  } catch {
    return null;
  }
}

export function writeDraft(storage: DraftStorage | null, draft: EditorDraft): void {
  if (!storage) return;
  try {
    storage.setItem(draftKey(draft.id), JSON.stringify(draft));
  } catch {
    /* storage full or private mode — never surface this */
  }
}

export function clearDraft(storage: DraftStorage | null, id?: string | null): void {
  if (!storage) return;
  try {
    storage.removeItem(draftKey(id));
  } catch {
    /* ignore */
  }
}
