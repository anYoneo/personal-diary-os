import { describe, expect, it } from "vitest";
import {
  DRAFT_PREFIX,
  clearDraft,
  draftHasNewerWriting,
  draftKey,
  parseDraft,
  readDraft,
  writeDraft,
  type DraftStorage,
} from "@/lib/draft";

/**
 * The local draft mirror exists because of a real report: while writing, an
 * autosave landed and part of the text disappeared, and clicking Save afterwards
 * did nothing.
 *
 * The decisive defect was that the mirror only ran while an entry had no id yet.
 * The first autosave created the entry, the mirror stopped, and every later
 * keystroke lived only in React state — so a refused save (the conflict the
 * editor was latched into) left nothing to recover from. These tests pin the two
 * properties that were missing: the mirror covers entries that already exist,
 * and it is keyed per entry so one entry's draft cannot surface in another.
 */
function fakeStorage(initial: Record<string, string> = {}): DraftStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
    removeItem: (key: string) => {
      delete data[key];
    },
  };
}

describe("draft keys", () => {
  it("namespaces per entry, and uses one base slot for a new entry", () => {
    expect(draftKey(null)).toBe(DRAFT_PREFIX);
    expect(draftKey(undefined)).toBe(DRAFT_PREFIX);
    expect(draftKey("abc")).toBe(`${DRAFT_PREFIX}.abc`);

    // Editing entry A must not collide with entry B — the cross-entry leak the
    // old single key made possible.
    expect(draftKey("a")).not.toBe(draftKey("b"));
  });
});

describe("parseDraft", () => {
  it("returns null for junk instead of throwing", () => {
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft("")).toBeNull();
    expect(parseDraft("{not json")).toBeNull();
    expect(parseDraft('{"title":"no content"}')).toBeNull();
  });

  it("fills in a missing timestamp rather than trusting undefined", () => {
    const draft = parseDraft('{"content":"hi","id":"x"}');
    expect(draft?.content).toBe("hi");
    expect(draft?.id).toBe("x");
    expect(typeof draft?.at).toBe("string");
  });
});

describe("draftHasNewerWriting", () => {
  const draft = (content: string) => ({ id: "x", content, title: null, at: "2026-10-05T10:00:00.000Z" });

  it("ignores an empty or whitespace-only draft", () => {
    expect(draftHasNewerWriting(null, { content: "server" })).toBe(false);
    expect(draftHasNewerWriting(draft(""), { content: "server" })).toBe(false);
    expect(draftHasNewerWriting(draft("   \n "), { content: "server" })).toBe(false);
  });

  it("does not resurrect a draft the server already has", () => {
    expect(draftHasNewerWriting(draft("same text"), { content: "same text" })).toBe(false);
  });

  it("restores writing the server does not have", () => {
    expect(draftHasNewerWriting(draft("newer"), { content: "older" })).toBe(true);
    expect(draftHasNewerWriting(draft("typed after the save"), { content: "" })).toBe(true);
  });
});

describe("read / write / clear round trip", () => {
  it("keeps writing for an entry that already has an id", () => {
    // The regression: this is the case the editor used to skip entirely.
    const storage = fakeStorage();
    writeDraft(storage, { id: "entry-1", content: "text after the first autosave", title: "T", at: "now" });

    const back = readDraft(storage, "entry-1");
    expect(back?.content).toBe("text after the first autosave");
    expect(back?.title).toBe("T");
  });

  it("does not leak a draft across entries", () => {
    const storage = fakeStorage();
    writeDraft(storage, { id: "entry-1", content: "belongs to one", title: null, at: "now" });
    expect(readDraft(storage, "entry-2")).toBeNull();

    // A brand-new entry must not inherit a saved entry's draft either.
    expect(readDraft(storage, null)).toBeNull();
  });

  it("clears only the entry it is given", () => {
    const storage = fakeStorage();
    writeDraft(storage, { id: "entry-1", content: "one", title: null, at: "now" });
    writeDraft(storage, { id: "entry-2", content: "two", title: null, at: "now" });

    clearDraft(storage, "entry-1");
    expect(readDraft(storage, "entry-1")).toBeNull();
    expect(readDraft(storage, "entry-2")?.content).toBe("two");
  });

  it("never throws when storage refuses to write (quota, private mode)", () => {
    const hostile: DraftStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota exceeded");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };

    expect(() =>
      writeDraft(hostile, { id: "x", content: "c", title: null, at: "now" }),
    ).not.toThrow();
    expect(readDraft(hostile, "x")).toBeNull();
    expect(() => clearDraft(hostile, "x")).not.toThrow();
  });

  it("tolerates a null storage (server render, unsupported browser)", () => {
    expect(() => writeDraft(null, { id: "x", content: "c", title: null, at: "now" })).not.toThrow();
    expect(readDraft(null, "x")).toBeNull();
    expect(() => clearDraft(null, "x")).not.toThrow();
  });
});
