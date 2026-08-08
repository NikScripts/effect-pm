# last-ts codesplit

**Status:** Eng — P0–P3 landed; View annotations/`Last`/`fromEffect`/`gen` on work tip; P4 shims/docs polish remain; tip-sync pending owner  
**Branch:** `cursor/file-router-prototype-125f`  
**npm:** `last-ts@0.0.1` · code name **Last.ts**  
**Repo:** same-workspace `packages/last-ts` first; `hyperlink-ts` depends on it  
**Not this plan:** bare `last.ts` / `last-js` (npm similarity blocks); scoped `@nikolasstow/last.ts` was unpublished intent

## Locked decisions

1. **Never ship a lie** for path/docgen artifacts — commit gen, emit/watch in dev, CI check; no `string` fallback.
2. **Building blocks → `last-ts`.** Hyperlink site / web / TUI / CLI / Dashboard stay on **`hyperlink-ts`**.
3. **`hyperlink-ts` depends on `last-ts`.** No reverse imports. Zero Hyperlink mentions inside last-ts.
4. **Module layout (Effect-true):** one file = one namespace. No nested bags (`Last.View` banned).
5. **Package root like `effect`:** `index` barrels **real** modules only
   (`export * as View from "./View"`, …). No hollow `Last` stub “for later.”
6. **`Last.ts`** — cross-cutting handle introspection (`kindSym` / `kindOf`). Product/npm
   name remains **last-ts** / Last.ts; module subpaths carry the rest of the surface.
7. **`last-ts/View`** — DI (`Tag` / `Prototype` / `provide` / annotations) **plus** plain
   export (`fromEffect` / `gen` / `succeed`). **No** dashboard matchers/Registry/size chrome.
   **`ChromeProvider` is Hyperlink-shaped** (shell hints) — park/move off last-ts; do not
   treat it as core Last API. Hyperlink `Views` match/kit is v1 and needs a composable redesign.
8. **Do not compete on the name `View`.** Hyperlink dashboard surface is **`Views`**
   (`hyperlink-ts/ui/Views`): size ancestors (`Card` / `Detail` / `Page`), Registry, bind/only,
   react kit, compose. Apps: `import * as View from "last-ts/View"` (or thin
   `hyperlink-ts/ui/View` re-export) for DI; `import * as Views from "hyperlink-ts/ui/Views"`
   for dashboard contribution.
9. **Rejected:** inventing a competing `Ui.*` namespace for what was only a rename of size chrome.
   **Rejected:** keeping size / Registry on the `View` namespace.
10. **File-router `Page` (marks) → last-ts.** Unrelated to dashboard `Views.Page`.
11. **GroupNav + Group-aware compose / Target helpers → hyperlink** (v1). last-ts Route is catalog-only.
12. **Docgen + vite/path codegen** ship with last-ts (tools), not a separate npm package for now.
13. **`AtomReact` (+ Runtime provider) → last-ts** — Effect Atom ↔ React hooks; not nested under `View`.
14. **`Hyperlink` module does not move or rename.** `Hyperlink.useQuery` and the other
    Hyperlink reactive helpers stay on `hyperlink-ts/Hyperlink`; they may only need
    **dependency updates** (import Atom hooks / types from last-ts instead of `ui/atom-react`).

## Package graph

```text
last-ts
  └─ (peers: effect, react, …)
hyperlink-ts
  └─ depends on last-ts
docs/site, examples
  └─ hyperlink-ts (+ last-ts as needed)
```

## `last-ts` public surface

Effect-shaped: subpaths are the modules; root `index` barrels those namespaces (same idea as
`effect`’s barrel). **`Last.ts` is not required for P0–P3.**

| Subpath | Namespace | Role |
|---------|-----------|------|
| `.` | *(barrel)* | `export * as View from "./View"` (etc.) — real modules only |
| `./Last` | `Last` | `kindSym` / `kindOf` — factory brands on stamped handles |
| `./View` | `View` | Tag/Prototype/provide (DI) + `fromEffect` (plain export) + annotations / kind |
| `./Route` | `Route` | Catalog: make/get/group/match/urlBuilder/fileRoot — **no** Group Target chrome |
| `./Router` | `Router` | memory/history/Provider/Link/Outlet |
| `./Router/waku` | *(waku module)* | Waku layer adapters |
| `./Page` | `Page` | File-router marks: static/dynamic/build/layout, stampOf |
| `./vite` | *(plugin)* | fileRouter emit/watch + check helpers (+ published bin later) |
| `./AtomReact` | `AtomReact` | `RegistryProvider`, `useAtomValue`, `useAtomSet`, … (+ Runtime provider unless split) |
| `./docgen` (+ modules) | per-file | Move from `docs/docgen` |
| `./Last` | `Last` | **Only when** there is a real Last API — not an empty placeholder |

```ts
import * as View from "last-ts/View"
import * as Route from "last-ts/Route"
import * as Router from "last-ts/Router"
import * as Page from "last-ts/Page"
import { fileRouter } from "last-ts/vite"
// later, if earned:
// import * as Last from "last-ts/Last"
```

**Not in last-ts:** `ViewKind`, `Card`/`Detail`/`Page` sizes, `SizeChrome`, GroupDash, dashboard `compose`, family views, Observe packs, GroupNav, any `hyperlink-ts` import.

## `hyperlink-ts` UI surface (after cut)

| Subpath | Namespace | Role |
|---------|-----------|------|
| `./ui/View` | `View` | Thin re-export of `last-ts/View` (DI only) |
| `./ui/Views` | `Views` | Size chrome (`Card`/`Detail`/`Page`), Registry, bind/only, react, compose |
| `./ui/GroupNav` | `GroupNav` | Group tree nav |
| `./ui/*View` | family | WorkPoolView, DaemonView, … (`extends Views.Card.Service` etc.) |
| `./ui/DashboardViews` | `DashboardViews` | Merged contributions |
| `./web`, `./tui`, `./cli` | platform | Batteries Dashboard, Ink, CLI |

```ts
import * as View from "last-ts/View"                 // or hyperlink-ts/ui/View
import * as Views from "hyperlink-ts/ui/Views"

class PoolCard extends Views.Card.Service<PoolCard>()("…") {}
Views.bind(WorkPool.kind, PoolCard)
Views.compose({ views, router, group })
```

File-router marks stay `Page.*` from last-ts — not `Views.Page`.

Optional temporary re-exports on `hyperlink-ts/ui/Route` etc. during migration — drop when callers moved.

## Move / strip checklist

| Today | Action |
|-------|--------|
| `src/ui/Page`, `src/vite/fileRouter`, `internal/fileRouterPaths` | → last-ts |
| `docs/docgen` | → last-ts/docgen |
| `src/ui/Route` catalog | → last-ts; Target/viewOf/memberOf → hyperlink (`GroupNav` or `ui/RouteTarget`) |
| `src/ui/Router`, `RouterWaku` | → last-ts |
| `src/ui/View` DI kernel | → last-ts/View; hyperlink `ui/View` = re-export only |
| Size chrome + Registry + bind/only/react/compose | → `hyperlink-ts/ui/Views` |
| Family views, packs, data, DashboardViews, GroupNav | stay hyperlink |
| `Hyperlink.ts` (`useQuery`, live/command binders, …) | **stay** — update imports/deps to last-ts only as needed |
| `web` / `tui` / `cli` | stay hyperlink |

## Eng phases

| Phase | Work |
|-------|------|
| **P0** | `packages/last-ts` workspace skeleton; real modules + Effect-style barrel; peers; CI build — **Eng’d** |
| **P1** | Page + vite/path codegen + docgen move; example `paths:check`; hyperlink depends — **Eng’d** |
| **P2** | Route/Router move; Target helpers stay on hyperlink — **Eng’d** |
| **P3** | View kernel → last-ts; size/Registry/bind/compose → Hyperlink `Views` — **Eng’d** |
| **P4** | Drop shims; docs/guides; changesets for both packages |

## Open (next locks)

- Publish cadence for last-ts beyond workspace `0.0.1`.
- **`Page.Service` + Layout** — design in [`page-layout-design.md`](../handoffs/page-layout-design.md); lock then Eng. Optional host adapter after (not a reopen of static/dynamic).
- **P4** — drop hyperlink re-export shims once callers on `last-ts/*`; guide polish.
- `Last` module earned (`kindSym` / `kindOf`) — done; grow only with real cross-cuts.
- Fold `RuntimeProvider` stays on `AtomReact` unless size hurts.

## Related

- [file-router prototype](../handoffs/file-router-prototype.md)
- [view-page-naming](../handoffs/view-page-naming.md)
- [file-router guide](../guides/file-router.md)
- Module layout: `.cursor/rules/module-layout.mdc`
