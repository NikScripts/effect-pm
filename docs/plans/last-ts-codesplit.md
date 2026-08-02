# last-ts codesplit

**Status:** Eng — P0–P3 landed (`View` DI on last-ts; size chrome / Registry / bind / compose on Hyperlink `Views`); P4 shims/docs polish remain  
**Branch:** `cursor/file-router-prototype-125f`  
**npm:** `last-ts@0.0.0` reserved · code name **Last.ts**  
**Repo:** same-workspace `packages/last-ts` first; `hyperlink-ts` depends on it  
**Not this plan:** bare `last.ts` / `last-js` (npm similarity blocks); scoped `@nikolasstow/last.ts` was unpublished intent

## Locked decisions

1. **Never ship a lie** for path/docgen artifacts — commit gen, emit/watch in dev, CI check; no `string` fallback.
2. **Building blocks → `last-ts`.** Hyperlink site / web / TUI / CLI / Dashboard stay on **`hyperlink-ts`**.
3. **`hyperlink-ts` depends on `last-ts`.** No reverse imports. Zero Hyperlink mentions inside last-ts.
4. **Module layout (Effect-true):** one file = one namespace. No nested bags (`Last.View` banned).
5. **Package root like `effect`:** `index` barrels **real** modules only
   (`export * as View from "./View"`, …). No hollow `Last` stub “for later.”
6. **`Last.ts` lands only when it has a real cross-cutting API** (flat `export const`s).
   Until then the product/npm name is still **last-ts** / Last.ts; subpaths carry the surface.
7. **`last-ts/View` = DI only** — `Tag` / `Prototype` / `provide` / generic `Chrome`.
   **No** `ViewKind`, Card/Detail/Page, Registry, bind/only, react matchers, or compose.
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
| `./View` | `View` | DI kernel only: Tag, Prototype, provide, Chrome |
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
| `./ui/*View` | family | WorkPoolView, DaemonView, … (`extends Views.Card.Tag` etc.) |
| `./ui/DashboardViews` | `DashboardViews` | Merged contributions |
| `./web`, `./tui`, `./cli` | platform | Batteries Dashboard, Ink, CLI |

```ts
import * as View from "last-ts/View"                 // or hyperlink-ts/ui/View
import * as Views from "hyperlink-ts/ui/Views"

class PoolCard extends Views.Card.Tag<PoolCard>()("…") {}
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

- Publish cadence for last-ts beyond `0.0.0` placeholder.
- `Page.Tag` + docs-site createPages (product follow-ons on last-ts/Page).
- First real API that earns a `Last` module (do not invent one).
- Fold `RuntimeProvider` into `AtomReact` vs `last-ts/Runtime` (prefer one module unless size hurts).

## Related

- [file-router prototype](../handoffs/file-router-prototype.md)
- [view-page-naming](../handoffs/view-page-naming.md)
- [file-router guide](../guides/file-router.md)
- Module layout: `.cursor/rules/module-layout.mdc`
