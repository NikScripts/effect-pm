---
"hyperlink-ts": minor
---

`@nikscripts/effect-pm/web` now **ships the real dashboard** — the hand-crafted, per-type UI that was previously trapped in the example, not the old generic introspection view.

- **`<Dashboard runtime={Atom.runtime(layer)} group={ServicesHub} />`** — batteries-included responsive drill-down (queue / process / subgroup cards → styled detail with stats + edge-to-edge metric chart + icon controls + logs → routed fullscreen log viewer at `/Group/Resource/logs`), URL-backed navigation (deep links + back/forward) with view-transition animations, locked-by-default controls with a confirm dialog on destructive actions.
- **Compose the pieces:** `DashboardView` + the widgets (`QueueStats`, `MetricChart`, `QueueControls`, `ProcessControls`, `LogStream`, `Cell`, …) + the data layer (`queueBundle`/`processBundle`, `useQueueBundle`/`useProcessBundle`) under `RegistryProvider` + `RuntimeProvider` + `ViewTransitionProvider`.
- Runtime-injected (no module-level singleton); bundles derive from the contract schemas, browser-safe (no node deps). The example web dashboard now consumes `/web` directly (dogfooded).

BREAKING: the old generic introspection exports are removed — `GroupView`, `ResourceView`/`ResourceWidget`/`useResourceUI`, `panels`, `primitives`, `binding`, `chart`. Use `<Dashboard>` / `DashboardView` + the per-type widgets instead.
