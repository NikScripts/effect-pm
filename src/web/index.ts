/**
 * @module web
 *
 * **Contract-driven web widgets** for the resource toolkit — the web counterpart to
 * the CLI/TUI renderers. Point them at a `Resource` tag (local or remote via
 * `Resource.client` + `connect`) or a whole `Group` tree and they render: queues,
 * processes, schedules, runs, and nested groups, with live status/metrics/logs and
 * actuating controls — all derived from each contract (`specOf` / `methodMeta`), so
 * new resources appear with no extra code.
 *
 * ```tsx
 * import { GroupView, RegistryProvider } from "@nikscripts/effect-pm/web";
 * // runtime provides every tag (Resource.client + connect for remote hosts)
 * <RegistryProvider><GroupView runtime={runtime} group={ServicesHub} /></RegistryProvider>
 * ```
 *
 * React is a peer dependency; the widgets use Tailwind utility classes.
 *
 * @since 1.0.0
 */
export * from "../ui/atom-react";
export * from "./useViewTransition";
export * from "./binding";
export * from "./primitives";
export * from "./panels";
export * from "./chart";
export * from "./ResourceWidget";
export * from "./widgets";
export * from "./GroupView";
