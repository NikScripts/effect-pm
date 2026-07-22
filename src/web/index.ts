/**
 * @module web
 *
 * **The resource dashboard for the browser** — the web counterpart to the CLI/TUI renderers.
 * Point `<Dashboard runtime group />` at a reactive `runtime` (an `Atom.runtime(layer)` over
 * your tags — local engine or `Hyperlink.client` over http) and a root `Group`, and it renders
 * the responsive drill-down: queue / process / subgroup cards, a styled detail per resource
 * (stats + chart + controls + logs), and a routed fullscreen log viewer — URL-backed
 * navigation with view-transition animations.
 *
 * ```tsx
 * import { Dashboard } from "hyperlink-ts/web";
 * import { Atom } from "effect/unstable/reactivity";
 * const runtime = Atom.runtime(appLayer); // appLayer: Hyperlink.client(...) over http
 * <Dashboard runtime={runtime} group={ServicesHub} />
 * ```
 *
 * Or compose the pieces: `DashboardView` + the widgets + `useQueueBundle` / `useProcessBundle`
 * under `RegistryProvider` + `RuntimeProvider` + `ViewTransitionProvider`.
 *
 * Peers: `react`, `react-dom`, `recharts`. Styled with Tailwind utility classes + shadcn theme
 * tokens (`@source` + theme wiring in the consuming app).
 *
 */
export * from "../ui/atom-react";
export * from "./useViewTransition";
export * from "./useGroupRoute";
export * from "./data";
export * from "./runtime";
export * from "./widgets";
export * from "./widget-registry";
export * from "./Dashboard";
export * from "./debug-console";
export { cn } from "./cn";
