/**
 * Day-bucket helpers. Everything timezone-sensitive goes through here so the
 * timeline, streaks, "on this day" and analytics all agree on what "a day" is.
 */
import { config } from "./config";

export const TIMEZONE = config.timezone;

/** Local calendar day of an instant, as YYYY-MM-DD in the user's timezone. */
export function dayKey(date: Date = new Date(), timeZone: string = TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Local hour (0-23) of an instant. */
export function localHour(date: Date = new Date(), timeZone: string = TIMEZONE): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);
  return Number(parts.find((p) => p.type === "hour")?.value ?? "0");
}

/** UTC instant of local midnight for a YYYY-MM-DD day key. */
export function dayKeyToUtcStart(key: string, timeZone: string = TIMEZONE): Date {
  const [y, m, d] = key.split("-").map(Number);
  // Offset of the timezone at roughly that date (good enough for day bucketing).
  const probe = new Date(Date.UTC(y, m - 1, d, 12));
  const offset = timeZoneOffsetMinutes(probe, timeZone);
  return new Date(Date.UTC(y, m - 1, d) - offset * 60_000);
}

export function timeZoneOffsetMinutes(date: Date, timeZone: string = TIMEZONE): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return (asUtc - date.getTime()) / 60_000;
}

export function addDays(key: string, delta: number): string {
  const d = dayKeyToUtcStart(key);
  d.setUTCDate(d.getUTCDate() + delta);
  return dayKey(d);
}

export function greeting(date: Date = new Date(), timeZone: string = TIMEZONE): string {
  const h = localHour(date, timeZone);
  if (h < 5) return "Still awake";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 22) return "Good evening";
  return "Late night";
}

/** Long human date, e.g. "Monday, September 28, 2026". */
export function longDate(date: Date | string, timeZone: string = TIMEZONE): string {
  const d = typeof date === "string" ? parseDayKey(date) : date;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
}

export function shortDate(date: Date | string, timeZone: string = TIMEZONE): string {
  const d = typeof date === "string" ? parseDayKey(date) : date;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

export function timeOfDay(date: Date | string, timeZone: string = TIMEZONE): string {
  const d = typeof date === "string" ? parseDayKey(date) : date;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/** Parse YYYY-MM-DD into a UTC-noon instant (safe for month/year formatting). */
export function parseDayKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

export function monthLabel(key: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(parseDayKey(`${key}-01`));
}

export function relativeDay(key: string, todayKey: string): string {
  const diff = Math.round(
    (parseDayKey(todayKey).getTime() - parseDayKey(key).getTime()) / 86_400_000,
  );
  if (diff === 0) return "today";
  if (diff === 1) return "yesterday";
  if (diff < 7) return `${diff} days ago`;
  if (diff < 30) return `${Math.floor(diff / 7)} weeks ago`;
  if (diff < 365) return `${Math.floor(diff / 30)} months ago`;
  const years = Math.floor(diff / 365);
  return years === 1 ? "a year ago" : `${years} years ago`;
}
