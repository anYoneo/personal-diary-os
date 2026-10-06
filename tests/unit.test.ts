import { describe, expect, it } from "vitest";
import { countWords, excerpt, readingTimeMinutes, toPlainText, titleOrExcerpt } from "@/lib/markdown";
import { currentStreak } from "@/lib/services/entries";
import { dayKey, addDays, greeting, relativeDay, dayKeyToUtcStart } from "@/lib/day";
import { parseCapture } from "@/lib/services/capture";
import { entryCreateSchema, entryUpdateSchema } from "@/lib/validation";

/**
 * Regression: in Zod 4 `.partial()` preserves `.default()`, so a PATCH built with
 * `.partial()` silently injected `entryType: "daily"` and `tags: []` into every
 * autosave — resetting the type and deleting the tags. Absent keys must stay absent.
 */
describe("entry schemas", () => {
  it("PATCH leaves omitted fields absent instead of defaulting them", () => {
    const parsed = entryUpdateSchema.parse({ content: "just a body edit" });
    expect("entryType" in parsed).toBe(false);
    expect("tags" in parsed).toBe(false);
    expect("isImportant" in parsed).toBe(false);
    expect("mood" in parsed).toBe(false);
    expect(parsed.content).toBe("just a body edit");
  });

  it("PATCH still accepts explicit values, including clearing tags", () => {
    const parsed = entryUpdateSchema.parse({ entryType: "work", tags: [], mood: null });
    expect(parsed.entryType).toBe("work");
    expect(parsed.tags).toEqual([]);
    expect(parsed.mood).toBeNull();
  });

  it("PATCH keeps a whitespace body so a draft can be cleared", () => {
    expect(entryUpdateSchema.parse({ content: "   " }).content).toBe("   ");
  });

  it("CREATE applies defaults", () => {
    const parsed = entryCreateSchema.parse({ content: "hello" });
    expect(parsed.entryType).toBe("daily");
    expect(parsed.tags).toEqual([]);
    expect(parsed.source).toBe("web");
  });

  it("CREATE rejects a whitespace-only entry", () => {
    expect(entryCreateSchema.safeParse({ content: "   " }).success).toBe(false);
  });

  it("CREATE strips a leading # from tags", () => {
    expect(entryCreateSchema.parse({ content: "x", tags: ["#work"] }).tags).toEqual(["work"]);
  });
});

describe("markdown metrics", () => {
  it("counts words without markdown noise", () => {
    expect(countWords("Hello **world** and `code` here")).toBe(4);
    expect(countWords("```\nblock of code\n```")).toBe(0);
  });

  it("excerpts on a word boundary", () => {
    const text = "alpha beta gamma delta epsilon zeta eta theta iota kappa";
    const result = excerpt(text, 20);
    expect(result.endsWith("…")).toBe(true);
    expect(result.length).toBeLessThanOrEqual(21);
  });

  it("strips list and heading markers from plain text", () => {
    expect(toPlainText("- [ ] task\n## Heading\n> quote")).toContain("task");
    expect(toPlainText("## Heading")).not.toContain("#");
  });

  it("reports reading time in whole minutes", () => {
    const long = Array.from({ length: 440 }, () => "word").join(" ");
    expect(readingTimeMinutes(long)).toBe(2);
    expect(readingTimeMinutes("one")).toBe(0);
  });

  it("falls back to an excerpt when no title is set", () => {
    expect(titleOrExcerpt(null, "The start of something")).toBe("The start of something");
    expect(titleOrExcerpt("Real title", "body")).toBe("Real title");
  });
});

describe("day buckets", () => {
  it("uses the user's timezone, not UTC", () => {
    // 2026-09-28T17:30Z is already the 29th in Jakarta (UTC+7).
    const instant = new Date("2026-09-28T17:30:00Z");
    expect(dayKey(instant, "UTC")).toBe("2026-09-28");
    expect(dayKey(instant, "Asia/Jakarta")).toBe("2026-09-29");
  });

  it("maps a day key back to local midnight", () => {
    const start = dayKeyToUtcStart("2026-09-28", "Asia/Jakarta");
    expect(start.toISOString()).toBe("2026-09-27T17:00:00.000Z");
  });

  it("walks days", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
  });

  it("greets by local hour", () => {
    // 23:00Z is 06:00 in Jakarta (UTC+7) — the bucket must follow local time.
    expect(greeting(new Date("2026-09-28T23:00:00Z"), "Asia/Jakarta")).toBe("Good morning");
    expect(greeting(new Date("2026-09-28T01:00:00Z"), "Asia/Jakarta")).toBe("Good morning");
    expect(greeting(new Date("2026-09-28T19:00:00Z"), "Asia/Jakarta")).toBe("Still awake");
  });

  it("describes relative distance", () => {
    expect(relativeDay("2026-09-27", "2026-09-28")).toBe("yesterday");
    expect(relativeDay("2024-09-28", "2026-09-28")).toBe("2 years ago");
  });
});

describe("streaks", () => {
  it("counts consecutive days back from today", () => {
    const days = ["2026-09-28", "2026-09-27", "2026-09-26", "2026-09-24"];
    expect(currentStreak(days, "2026-09-28")).toBe(3);
  });

  it("keeps yesterday's streak alive until today is written", () => {
    const days = ["2026-09-27", "2026-09-26"];
    expect(currentStreak(days, "2026-09-28")).toBe(2);
  });

  it("breaks when the last entry is older than yesterday", () => {
    expect(currentStreak(["2026-09-20"], "2026-09-28")).toBe(0);
    expect(currentStreak([], "2026-09-28")).toBe(0);
  });
});

describe("discord capture parsing", () => {
  it("strips a remember prefix and keeps the text", () => {
    const parsed = parseCapture("Remember this: today I discovered the credit limit bug");
    expect(parsed.content).toBe("today I discovered the credit limit bug");
    expect(parsed.entryType).toBe("daily");
  });

  it("maps prefixes to entry types", () => {
    expect(parseCapture("idea: a better onboarding").entryType).toBe("idea");
    expect(parseCapture("problem: the migration blocks on locks").entryType).toBe("problem");
    expect(parseCapture("goal: learn TOGAF").entryType).toBe("goal");
    expect(parseCapture("lesson: always check the timezone first").entryType).toBe("lesson");
  });

  it("extracts inline tags and mood", () => {
    const parsed = parseCapture("worked late again #work #tired mood: anxious");
    expect(parsed.tags).toEqual(["work", "tired"]);
    expect(parsed.mood).toBe("anxious");
    expect(parsed.content).toBe("worked late again");
  });

  it("flags questions as unresolved thoughts", () => {
    expect(parseCapture("question: should I stay on the ERP project?").createThought).toBe(true);
    expect(parseCapture("plain note").createThought).toBe(false);
  });

  it("refuses to save an empty capture", () => {
    expect(parseCapture("#work").isCommand).toBe(true);
    expect(parseCapture("   ").isCommand).toBe(true);
  });
});
