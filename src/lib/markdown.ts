/**
 * Markdown-derived measurements. Pure functions so the editor can run them on
 * every keystroke client-side and the server can recompute on save.
 */

const CODE_BLOCK = /```[\s\S]*?```/g;
const INLINE_CODE = /`[^`]*`/g;
const IMAGE = /!\[[^\]]*\]\([^)]*\)/g;
const LINK = /\[([^\]]*)\]\([^)]*\)/g;
const MARKUP = /[*_~>#|-]/g;

/** Plain text projection of a markdown document, used for word counts and excerpts. */
export function toPlainText(markdown: string): string {
  return markdown
    .replace(CODE_BLOCK, " ")
    .replace(INLINE_CODE, " ")
    .replace(IMAGE, " ")
    .replace(LINK, "$1")
    .replace(MARKUP, " ")
    .replace(/\[[ xX]\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function countWords(markdown: string): number {
  const text = toPlainText(markdown);
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

export function readingTimeMinutes(markdown: string): number {
  return Math.max(0, Math.round(countWords(markdown) / 220));
}

/** First meaningful line(s) of an entry, for lists and timeline previews. */
export function excerpt(markdown: string, maxChars = 180): string {
  const text = toPlainText(markdown);
  if (text.length <= maxChars) return text;
  const clipped = text.slice(0, maxChars);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace > 40 ? lastSpace : maxChars).trimEnd()}…`;
}

export function titleOrExcerpt(title: string | null | undefined, markdown: string): string {
  if (title && title.trim()) return title.trim();
  const first = excerpt(markdown, 80);
  return first || "Untitled entry";
}
