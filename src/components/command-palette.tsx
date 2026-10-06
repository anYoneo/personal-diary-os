"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export type PaletteCommand = { id: string; label: string; hint?: string; href: string };

/**
 * Ctrl/Cmd+K palette. Navigation only — every command maps to a real route, so
 * nothing here can lie about what the app does.
 */
export function CommandPalette({ commands }: { commands: PaletteCommand[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [commands, query]);

  /** Reset the query and focus the field. Called from the open handler, not an effect. */
  const show = useCallback(() => {
    setQuery("");
    setIndex(0);
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const hide = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (open) hide();
        else show();
        return;
      }
      if (event.key === "Escape") {
        hide();
        return;
      }
      // Bare shortcuts only when the user isn't writing — never steal a keystroke.
      if (typing) return;
      if (event.key === "n" || event.key === "N") {
        event.preventDefault();
        router.push("/write");
      }
      if (event.key === "/" || event.key === "s") {
        if (event.key === "/" || (event.key === "s" && !event.shiftKey)) {
          event.preventDefault();
          router.push("/search");
        }
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "l") {
        event.preventDefault();
        const current = document.documentElement.dataset.theme;
        const next = current === "dark" ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem("diary.theme", next);
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, show, hide, open]);

  const run = (command?: PaletteCommand) => {
    if (!command) return;
    setOpen(false);
    router.push(command.href);
  };

  if (!open) return null;

  return (
    <div
      className="fade fixed inset-0 z-50 flex items-start justify-center px-4 pt-[14vh]"
      style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(3px)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div
        className="panel rise w-full max-w-lg overflow-hidden"
        style={{ boxShadow: "var(--shadow-2)", background: "var(--panel)" }}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="flex items-center gap-3 border-b px-4 py-3" style={{ borderColor: "var(--line-soft)" }}>
          <span className="mono text-xs" style={{ color: "var(--accent)" }}>
            ›
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, results.length - 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              }
              if (e.key === "Enter") {
                e.preventDefault();
                run(results[index]);
              }
            }}
            placeholder={commands.length ? "Where to?" : "Sign in first"}
            className="w-full bg-transparent text-sm outline-none"
            style={{ color: "var(--fg)" }}
          />
          <kbd className="mono text-[10px]" style={{ color: "var(--muted-2)" }}>
            esc
          </kbd>
        </div>

        {results.length > 0 ? (
          <ul className="max-h-80 overflow-y-auto py-1.5">
            {results.map((command, i) => (
              <li key={command.id}>
                <button
                  type="button"
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => run(command)}
                  className="flex w-full items-center justify-between px-4 py-2 text-left text-sm transition-colors"
                  style={{
                    background: i === index ? "var(--panel-2)" : "transparent",
                    color: i === index ? "var(--fg)" : "var(--fg-2)",
                  }}
                >
                  <span>{command.label}</span>
                  {command.hint ? (
                    <kbd className="mono text-[10px]" style={{ color: "var(--muted-2)" }}>
                      {command.hint}
                    </kbd>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-6 text-center text-sm" style={{ color: "var(--muted)" }}>
            No matching command.
          </p>
        )}

        <div
          className="flex items-center justify-between border-t px-4 py-2"
          style={{ borderColor: "var(--line-soft)" }}
        >
          <span className="label">Navigate</span>
          <span className="mono text-[10px]" style={{ color: "var(--muted-2)" }}>
            ↑↓ · ⏎
          </span>
        </div>
      </div>
    </div>
  );
}
