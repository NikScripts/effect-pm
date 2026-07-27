/**
 * @module ui
 *
 * **Shared dashboard core** for `hyperlink-ts/web` and `hyperlink-ts/tui` — DOM-free data
 * bundles, Group path resolve, widget registry (`forKind` / `forKey` / `widgetFor`), and the
 * React atom binding. Renderers import from here and supply their own chrome (History vs
 * `path`, DOM vs Ink).
 *
 * ```ts
 * import { queueBundle, resolveGroupRoute, withEntries, forKind } from "hyperlink-ts/ui"
 * import { RegistryProvider, useAtomValue } from "hyperlink-ts/ui"
 * ```
 *
 */
export * from "./atom-react";
export * from "./groupRoute";
export * from "./data";
export * from "./cache";
export * from "./now";
export * from "./memberKind";
export * from "./widgetRegistry";
/** Keyed Spec-based view registry (`View.make` / `View.react`) — prefer `import * as View`. */
export * as View from "./View";
/** Shared WorkPool View handles + contribution Layer (no platform TSX). */
export * as WorkPoolView from "./WorkPoolView";
/** Provider only — renderers expose a typed `useWidgets` (web cards vs TUI cells). */
export { WidgetsProvider } from "./widgetsContext";
