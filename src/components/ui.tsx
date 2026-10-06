"use client";

import Link from "next/link";
import { MOODS, ENTRY_TYPES } from "@/lib/validation";

export function MoodChip({ mood }: { mood: string | null }) {
  if (!mood) return null;
  const meta = MOODS.find((m) => m.key === mood);
  if (!meta) return null;
  return (
    <span className="mono text-[11px]" style={{ color: "var(--muted)" }} title={meta.label}>
      {meta.emoji}
    </span>
  );
}

export function TypeBadge({ type }: { type: string }) {
  const known = (ENTRY_TYPES as readonly string[]).includes(type);
  return (
    <span
      className="mono text-[10px] uppercase tracking-[0.12em]"
      style={{ color: known ? "var(--muted-2)" : "var(--danger)" }}
    >
      {type}
    </span>
  );
}

export function TagPills({ tags, max = 4 }: { tags: string[]; max?: number }) {
  if (!tags.length) return null;
  const shown = tags.slice(0, max);
  const rest = tags.length - shown.length;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map((tag) => (
        <Link key={tag} href={`/search?tag=${encodeURIComponent(tag)}`} className="tag-pill">
          #{tag}
        </Link>
      ))}
      {rest > 0 ? (
        <span className="mono text-[10px]" style={{ color: "var(--muted-2)" }}>
          +{rest}
        </span>
      ) : null}
    </span>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="panel px-6 py-10 text-center">
      <p className="font-serif text-[17px]" style={{ color: "var(--fg-2)" }}>
        {title}
      </p>
      <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>
        {body}
      </p>
      {action ? (
        <Link href={action.href} className="btn btn-accent mt-5">
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

/** Visually distinct panel for anything the model produced. */
export function AiPanel({ children, model }: { children: React.ReactNode; model?: string }) {
  return (
    <section
      className="panel px-4 py-3.5"
      style={{
        borderColor: "color-mix(in oklab, var(--info) 30%, var(--line))",
        background: "color-mix(in oklab, var(--info) 5%, var(--panel))",
      }}
    >
      <header className="mb-2 flex items-center justify-between">
        <span className="label" style={{ color: "var(--info)" }}>
          AI interpretation — not your words
        </span>
        {model ? (
          <span className="mono text-[10px]" style={{ color: "var(--muted-2)" }}>
            {model}
          </span>
        ) : null}
      </header>
      <div className="prose-diary text-[14.5px]">{children}</div>
    </section>
  );
}
