/**
 * @module web
 *
 * **The resource dashboard for the browser** — the web counterpart to the CLI/TUI renderers.
 * Point `<Dashboard runtime group />` at a reactive `runtime` (an `Atom.runtime(layer)` over
 * your tags — local engine or `Resource.client` over http) and a root `Group`, and it renders
 * the responsive drill-down: queue / process / subgroup cards, a styled detail per resource
 * (stats + chart + controls + logs), and a routed fullscreen log viewer — URL-backed
 * navigation with view-transition animations.
 *
 * ```tsx
 * import { Dashboard } from "@nikscripts/effect-pm/web";
 * import { Atom } from "effect/unstable/reactivity";
 * const runtime = Atom.runtime(appLayer); // appLayer: Resource.client(...) over httpClient
 * <Dashboard runtime={runtime} group={ServicesHub} />
 * ```
 *
 * Or compose the pieces: `DashboardView` + the widgets + `useQueueBundle` / `useProcessBundle`
 * under `RegistryProvider` + `RuntimeProvider` + `ViewTransitionProvider`.
 *
 * Peers: `react`, `react-dom`, `recharts`. Styled with Tailwind utility classes + shadcn theme
 * tokens — see `docs/legacy/guides/setup.md` §2a/§2b for the `@source` + token wiring.
 *
 * @since 1.0.0
 */
export * from "../ui/atom-react";
export * from "./useViewTransition";
export * from "./useGroupRoute";
export * from "./data";
export * from "./runtime";
export * from "./widgets";
export * from "./Dashboard";
export * from "./debug-console";
export { cn } from "./cn";
