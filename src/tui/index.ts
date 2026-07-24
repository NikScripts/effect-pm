/**
 * @module tui
 *
 * Building blocks for **terminal (Ink) resource dashboards** — the TUI half of the
 * {@link cli} control surface (`hyperlink-ts/cli`). Provide {@link layer} alongside your
 * resource layers so bare CLI paths open a dashboard; without it, bare paths fail as
 * `TuiNotConfigured`.
 *
 * Also re-exports the shared reactive binding (Ink is React, so the same `useAtomValue` /
 * `useAtomSet` / `RegistryProvider` drive an Ink tree) plus terminal render primitives —
 * bars, sparklines, compact numbers, a status theme — that you compose into your own widgets.
 *
 * ```ts
 * import * as Hyperlink from "hyperlink-ts/Hyperlink"
 * import { layer as tuiLayer } from "hyperlink-ts/tui"
 *
 * Hyperlink.cli.run(Fleet, { name: "hyperlink", version })(args).pipe(
 *   Effect.provide(Layer.mergeAll(appLayer, tuiLayer)),
 * )
 * ```
 *
 */
export * from "../ui/atom-react";
export { make, type AnyTag } from "./make";
export { layer } from "./layer";
export { Tui, TuiNotConfigured } from "../cli/index";

/** A resource's folded lifecycle state — the key of the default status theme. */
export type Status = "running" | "paused" | "draining" | "off";

/** Terminal color per {@link Status} (Ink color names). */
export const statusColor: Record<Status, string> = {
  running: "green",
  paused: "yellow",
  draining: "cyan",
  off: "red",
};

/** Glyph per {@link Status}. */
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

/** A horizontal bar string (`███░░░`) of `width`, filled to `value / max`. */
export const bar = (value: number, max: number, width: number): string => {
  const filled = max <= 0 ? 0 : Math.min(width, Math.round((value / max) * width));
  return "█".repeat(filled) + "░".repeat(width - filled);
};

const SPARK = "▁▂▃▄▅▆▇█";
/** A unicode sparkline (`▁▃▅█`) for a numeric series, scaled to its own max. */
export const spark = (values: ReadonlyArray<number>): string => {
  if (values.length === 0) {
    return "";
  }
  const max = Math.max(...values, 1);
  return values.map((v) => SPARK[Math.min(7, Math.floor((v / max) * 7))] ?? " ").join("");
};

/** Format milliseconds as seconds (`1.2s`). */
export const fmt = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

/**
 * Compact a count to ≤4 chars (`16k`, `1.3k`, `1.2M`) so deep live values never overflow a
 * fixed-width terminal column.
 *
 */
export const compact = (n: number): string =>
  n < 1000
    ? String(n)
    : n < 10_000
      ? `${(n / 1000).toFixed(1)}k`
      : n < 1_000_000
        ? `${Math.round(n / 1000)}k`
        : `${(n / 1_000_000).toFixed(1)}M`;

/** Display name from a tag id — the last `/` segment (`@acme/queues/Mail` → `Mail`). */
export const displayName = (key: string): string => key.split("/").pop() ?? key;
