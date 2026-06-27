/**
 * @module tui
 *
 * Building blocks for **terminal (Ink) resource dashboards** — the TUI counterpart to
 * `@nikscripts/effect-pm/web`. Re-exports the shared reactive binding (Ink is React, so the
 * same `useAtomValue` / `useAtomSet` / `RegistryProvider` drive an Ink tree) plus terminal
 * render primitives — bars, sparklines, compact numbers, a status theme — that you compose
 * into your own widgets. Composable pieces, **not** a generic auto-renderer.
 *
 * ```tsx
 * import { useAtomValue, bar, compact, statusColor } from "@nikscripts/effect-pm/tui";
 * import { Box, Text } from "ink";
 * // a queue cell, your styling: <Text color={statusColor[status]}>{bar(pending, max, 20)}</Text>
 * ```
 *
 * @since 1.0.0
 */
export * from "../ui/atom-react";

/** A resource's folded lifecycle state — the key of the default status theme. @since 1.0.0 */
export type Status = "running" | "paused" | "draining" | "off";

/** Terminal color per {@link Status} (Ink color names). @since 1.0.0 */
export const statusColor: Record<Status, string> = {
  running: "green",
  paused: "yellow",
  draining: "cyan",
  off: "red",
};

/** Glyph per {@link Status}. @since 1.0.0 */
export const statusIcon: Record<Status, string> = {
  running: "►",
  paused: "‖",
  draining: "↓",
  off: "■",
};

/**
 * An always-present **invisible** Ink border (spaces) so toggling a visible border on/off
 * never shifts layout — pass it as `borderStyle` for the "off" state.
 *
 * @since 1.0.0
 */
export const blankBorder = {
  topLeft: " ",
  top: " ",
  topRight: " ",
  right: " ",
  bottomRight: " ",
  bottom: " ",
  bottomLeft: " ",
  left: " ",
} as const;

/** A horizontal bar string (`███░░░`) of `width`, filled to `value / max`. @since 1.0.0 */
export const bar = (value: number, max: number, width: number): string => {
  const filled = max <= 0 ? 0 : Math.min(width, Math.round((value / max) * width));
  return "█".repeat(filled) + "░".repeat(width - filled);
};

const SPARK = "▁▂▃▄▅▆▇█";
/** A unicode sparkline (`▁▃▅█`) for a numeric series, scaled to its own max. @since 1.0.0 */
export const spark = (values: ReadonlyArray<number>): string => {
  if (values.length === 0) {
    return "";
  }
  const max = Math.max(...values, 1);
  return values.map((v) => SPARK[Math.min(7, Math.floor((v / max) * 7))] ?? " ").join("");
};

/** Format milliseconds as seconds (`1.2s`). @since 1.0.0 */
export const fmt = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

/**
 * Compact a count to ≤4 chars (`16k`, `1.3k`, `1.2M`) so deep live values never overflow a
 * fixed-width terminal column.
 *
 * @since 1.0.0
 */
export const compact = (n: number): string =>
  n < 1000
    ? String(n)
    : n < 10_000
      ? `${(n / 1000).toFixed(1)}k`
      : n < 1_000_000
        ? `${Math.round(n / 1000)}k`
        : `${(n / 1_000_000).toFixed(1)}M`;

/** Display name from a tag id — the last `/` segment (`@acme/queues/Mail` → `Mail`). @since 1.0.0 */
export const displayName = (key: string): string => key.split("/").pop() ?? key;
