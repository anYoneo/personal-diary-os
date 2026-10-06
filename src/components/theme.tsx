"use client";

import { useCallback, useSyncExternalStore } from "react";

type Theme = "dark" | "light";
const KEY = "diary.theme";

/** Applied before first paint so the theme never flashes. Rendered in <head>. */
export function ThemeScript() {
  const code = `(function(){try{var t=localStorage.getItem('${KEY}');if(!t){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='dark';}})();`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}

/**
 * The theme lives on <html data-theme> (set by ThemeScript before paint), so it
 * is read through useSyncExternalStore rather than mirrored into state on mount —
 * no setState-in-effect, and no hydration mismatch.
 */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

const readTheme = (): Theme =>
  (document.documentElement.dataset.theme as Theme) ?? "dark";

/** Server/first-paint snapshot: ThemeScript has not run on the server. */
const serverTheme = (): Theme => "dark";

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, readTheme, serverTheme);

  const apply = useCallback((next: Theme) => {
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Private mode: theme just won't persist.
    }
    for (const listener of listeners) listener();
  }, []);

  const toggle = useCallback(() => {
    apply(readTheme() === "dark" ? "light" : "dark");
  }, [apply]);

  return { theme, setTheme: apply, toggle };
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      className={`btn btn-ghost ${className}`}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      title="Theme (⌘/Ctrl + Shift + L)"
    >
      <span aria-hidden className="text-[13px] leading-none">
        {theme === "dark" ? "☾" : "☀"}
      </span>
    </button>
  );
}
