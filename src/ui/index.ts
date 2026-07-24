/**
 * @module ui
 *
 * **Shared dashboard core** for `hyperlink-ts/web` and `hyperlink-ts/tui` — DOM-free data
 * bundles, Group path resolve, and the React atom binding. Renderers import from here and
 * supply their own chrome (History vs `path`, DOM vs Ink).
 *
 * ```ts
 * import { queueBundle, resolveGroupRoute } from "hyperlink-ts/ui"
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
