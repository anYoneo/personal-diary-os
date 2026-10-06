"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";

type Facts = {
  from: string;
  to: string;
  entryCount: number;
  words: number;
  days: string[];
  tags: string[];
  threads: string[];
};

type Period = "week" | "month";

/**
 * Reflections are split in two on purpose:
 *   FACTS — arithmetic on your entries (always available);
 *   INTERPRETATION — written by a model, only when one is configured, and always
 *   rendered in a visually separate block so it can never be mistaken for memory.
 */
export function ReflectionPanel({
  week,
  month,
  aiConfigured,
}: {
  week: { facts: Facts };
  month: { facts: Facts };
  aiConfigured: boolean;
}) {
  const [period, setPeriod] = useState<Period>("week");
  const facts = period === "week" ? week.facts : month.facts;

  const [text, setText] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [sources, setSources] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setNote(null);
    setText(null);
    try {
      const result = await api<
        | { available: false; reason: string }
        | { available: true; text: string; model: string; sources: string[] }
      >("/api/ai", { method: "POST", body: { task: "reflection", period } });

      if (!result.available) {
        setNote(result.reason);
      } else {
        setText(result.text);
        setModel(result.model);
        setSources(result.sources);
      }
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Reflection failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="label">Reflection</h2>
        <div className="flex gap-1.5">
          {(["week", "month"] as Period[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                setPeriod(p);
                setText(null);
                setNote(null);
              }}
              className="chip"
              data-active={period === p}
            >
              {p === "week" ? "this week" : "this month"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── Facts ─────────────────────────────────────────────────────── */}
        <div className="panel px-4 py-4">
          <p className="label mb-3" style={{ color: "var(--ok)" }}>
            Facts from your entries
          </p>
          <p className="text-[13px]" style={{ color: "var(--fg-2)" }}>
            {facts.entryCount} {facts.entryCount === 1 ? "entry" : "entries"} ·{" "}
            {facts.words.toLocaleString("en-US")} words · {facts.days.length}{" "}
            {facts.days.length === 1 ? "day" : "days"} written
          </p>
          <p className="mono mt-1 text-[10px]" style={{ color: "var(--muted-2)" }}>
            {facts.from} → {facts.to}
          </p>

          {facts.days.length ? (
            <div className="mt-3 flex flex-wrap gap-1">
              {facts.days.map((day) => (
                <span key={day} className="tag-pill">
                  {day}
                </span>
              ))}
            </div>
          ) : null}

          {facts.tags.length ? (
            <div className="mt-3">
              <p className="label mb-1.5">Recurring tags</p>
              <div className="flex flex-wrap gap-1.5">
                {facts.tags.slice(0, 8).map((tag) => (
                  <Link key={tag} href={`/search?tag=${tag}`} className="tag-pill">
                    #{tag}
                  </Link>
                ))}
              </div>
            </div>
          ) : null}

          {facts.threads.length ? (
            <div className="mt-3">
              <p className="label mb-1.5">Threads touched</p>
              <p className="text-[12.5px]" style={{ color: "var(--muted)" }}>
                {facts.threads.join(" · ")}
              </p>
            </div>
          ) : null}

          {facts.entryCount === 0 ? (
            <p className="mt-3 text-[12.5px]" style={{ color: "var(--muted-2)" }}>
              Nothing written in this period — there is nothing to reflect on yet.
            </p>
          ) : null}
        </div>

        {/* ── Interpretation ───────────────────────────────────────────── */}
        <div
          className="panel px-4 py-4"
          style={{
            borderColor: "color-mix(in oklab, var(--info) 30%, var(--line))",
            background: "color-mix(in oklab, var(--info) 5%, var(--panel))",
          }}
        >
          <div className="mb-3 flex items-center justify-between">
            <p className="label" style={{ color: "var(--info)" }}>
              Interpretation {model ? `· ${model}` : ""}
            </p>
            {aiConfigured ? (
              <button
                type="button"
                onClick={() => void generate()}
                disabled={busy || facts.entryCount === 0}
                className="btn !py-1 text-[11.5px]"
              >
                {busy ? "Thinking…" : "Generate"}
              </button>
            ) : null}
          </div>

          {!aiConfigured ? (
            <>
              <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--muted)" }}>
                Not configured. Reflections with generated text need an AI provider.
              </p>
              <pre
                className="mono mt-3 overflow-x-auto rounded-[8px] border px-3 py-2.5 text-[11px] leading-relaxed"
                style={{ borderColor: "var(--line-soft)", background: "var(--bg-soft)", color: "var(--muted)" }}
              >
{`AI_PROVIDER="openai"   # or openrouter, groq, deepseek
AI_API_KEY="..."
AI_MODEL="gpt-4o-mini"`}
              </pre>
              <p className="mt-3 text-[12px] leading-relaxed" style={{ color: "var(--muted-2)" }}>
                The panel stays empty until then instead of showing invented text. When enabled, the
                model only receives the entries in this period and its output stays in this box —
                your entries are never rewritten.
              </p>
            </>
          ) : text ? (
            <>
              <div className="prose-diary text-[14px]">
                {text.split("\n").map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
              </div>
              {sources.length ? (
                <p className="mono mt-3 text-[10px]" style={{ color: "var(--muted-2)" }}>
                  based on {sources.length} {sources.length === 1 ? "entry" : "entries"} from this period
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--muted)" }}>
              {note ?? "Press Generate to summarise this period. The result is clearly marked as interpretation, never as fact."}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
