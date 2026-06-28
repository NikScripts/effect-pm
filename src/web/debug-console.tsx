/**
 * @module examples/web-dashboard/debug-console
 *
 * On-screen console for mobile (no devtools). Captures every `console.*` call plus uncaught
 * errors / rejections into a toggle-able overlay. Enable by adding **`?debug`** to the URL
 * (it's remembered in localStorage; `?debug=0` turns it off); a floating 🐛 button opens the
 * panel. `dlog(...)` is a debug-only logger that shows up here.
 */
import * as React from "react";
import { dateFromMillis, now } from "./now";

/** True when debug mode is on. `?debug` / `?debug=1` enables (and persists); `?debug=0` clears. */
export const debugEnabled = (): boolean => {
  if (typeof window === "undefined") return false;
  try {
    const p = new URLSearchParams(window.location.search).get("debug");
    if (p === "" || p === "1") localStorage.setItem("debug", "1");
    if (p === "0") localStorage.removeItem("debug");
    return localStorage.getItem("debug") === "1";
  } catch {
    return false;
  }
};

/** Log only in debug mode (appears in the overlay + the real console). */
export const dlog = (...args: ReadonlyArray<unknown>): void => {
  // @effect-diagnostics-next-line globalConsole:off
  if (debugEnabled()) console.log("[dbg]", ...args);
};

interface Line {
  readonly id: number;
  readonly level: string;
  readonly text: string;
  readonly t: number;
}
let lines: ReadonlyArray<Line> = [];
let nextId = 0;
const subs = new Set<() => void>();
const notify = (): void => subs.forEach((s) => s());

const stringify = (a: unknown): string => {
  if (typeof a === "string") return a;
  if (a instanceof Error) return `${a.name}: ${a.message}`;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
};
const append = (level: string, args: ReadonlyArray<unknown>): void => {
  lines = [...lines, { id: (nextId += 1), level, text: args.map(stringify).join(" "), t: now() }].slice(-500);
  notify();
};

let patched = false;
const patchConsole = (): void => {
  if (patched || typeof window === "undefined") return;
  patched = true;
  const methods = ["log", "info", "warn", "error", "debug"] as const;
  for (const level of methods) {
    const original = console[level].bind(console);
    console[level] = (...args: Array<unknown>): void => {
      append(level, args);
      original(...args);
    };
  }
  window.addEventListener("error", (e) => append("error", [e.message, `${e.filename}:${e.lineno}`]));
  window.addEventListener("unhandledrejection", (e) => append("error", ["unhandledrejection:", e.reason]));
};

const COLOR: Record<string, string> = {
  error: "#ef4444",
  warn: "#eab308",
  info: "#06b6d4",
  debug: "#94a3b8",
  log: "#cbd5e1",
};

const useLines = (): ReadonlyArray<Line> =>
  React.useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    () => lines,
    () => lines,
  );

/** The overlay. Render once at the app root; it's invisible unless debug mode is on. */
export const DebugConsole = (): React.ReactElement | null => {
  patchConsole();
  const [open, setOpen] = React.useState(false);
  const [enabled, setEnabled] = React.useState(() => debugEnabled());
  const all = useLines();
  // fully turn debug off: clear the persisted flag AND the ?debug URL param, then hide
  const disable = (): void => {
    try {
      localStorage.removeItem("debug");
      const url = new URL(window.location.href);
      url.searchParams.delete("debug");
      window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    } catch {
      /* ignore */
    }
    setEnabled(false);
  };
  const ref = React.useRef<HTMLDivElement>(null);
  // Auto-scroll to newest only while the user is already pinned to the bottom; if they've
  // scrolled up to read history, leave their position alone.
  const pinned = React.useRef(true);
  const onScroll = (): void => {
    const el = ref.current;
    if (el !== null) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };
  React.useEffect(() => {
    const el = ref.current;
    if (el !== null && pinned.current) el.scrollTop = el.scrollHeight;
  }, [all.length, open]);

  if (!enabled) return null;

  return (
    <div className="fixed bottom-2 right-2 z-50" style={{ marginBottom: "env(safe-area-inset-bottom)" }}>
      {open ? (
        <div className="flex h-[42dvh] w-[92vw] max-w-xl flex-col rounded-lg border bg-black/90 text-xs shadow-xl">
          <div className="flex items-center gap-2 border-b px-2 py-1">
            <strong className="flex-1">debug console · {all.length}</strong>
            <button
              type="button"
              onClick={() => {
                lines = [];
                notify();
              }}
              className="rounded border px-2 py-0.5"
            >
              clear
            </button>
            <button type="button" onClick={disable} className="rounded border px-2 py-0.5">
              disable
            </button>
            <button type="button" onClick={() => setOpen(false)} className="rounded border px-2 py-0.5">
              close
            </button>
          </div>
          <div ref={ref} onScroll={onScroll} className="flex-1 overflow-auto px-2 py-1 font-mono leading-snug">
            {all.map((l) => (
              <div key={l.id} className="whitespace-pre-wrap break-all" style={{ color: COLOR[l.level] ?? "#cbd5e1" }}>
                <span className="opacity-40">{dateFromMillis(l.t).toLocaleTimeString()} </span>
                {l.text}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-full border bg-black/80 px-3 py-2 text-sm shadow-lg"
        >
          🐛 {all.length}
        </button>
      )}
    </div>
  );
};
