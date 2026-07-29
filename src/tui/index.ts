/**
 * @module tui
 *
 * Building blocks for **terminal (Ink) resource dashboards** — the TUI half of the
 * {@link cli} control surface (`hyperlink-ts/cli`). Provide {@link layer} alongside your
 * resource layers so bare CLI paths open the Group {@link Dashboard} (same tree + path
 * model as `hyperlink-ts/web`); without it, bare paths fail as `TuiNotConfigured`.
 *
 * Also re-exports the shared reactive binding (Ink is React, so the same `useAtomValue` /
 * `useAtomSet` / `RegistryProvider` drive an Ink tree) plus terminal render primitives —
 * bars, sparklines, compact numbers, a status theme — that you compose into your own widgets.
 *
 * ```ts
 * import * as Hyperlink from "hyperlink-ts/Hyperlink"
 * import { layer as tuiLayer } from "hyperlink-ts/tui"
 *
 * Hyperlink.cli(Fleet, { name: "hyperlink", version })(args).pipe(
 *   Effect.provide(Layer.mergeAll(appLayer, tuiLayer)),
 * )
 * ```
 *
 */
export * from "../ui";
export * from "./chrome";
export { make, type AnyTag } from "./make";
export { layer } from "./layer";
export { Dashboard } from "./Dashboard";
export { DashboardShell } from "./DashboardShell";
export { base, Cell, DaemonCell, FallbackCell, GroupCell, PriorityCell, QueueCell, type TuiCellProps, type TuiCellWidget, type TuiWidgetRegistry } from "./cellWidgets";
export { RuntimeProvider, useRuntime } from "./runtime";
export { useGroupRoute } from "./useGroupRoute";
export { Tui, TuiNotConfigured } from "../cli/index";
export type { TuiOpenInput } from "../cli/Tui";
// Platform skins: `import * as WorkPoolView from "hyperlink-ts/tui/WorkPoolView"`
// / `import * as DashboardViews from "hyperlink-ts/tui/DashboardViews"`
// (not re-exported here — would clash with `hyperlink-ts/ui` handles).
