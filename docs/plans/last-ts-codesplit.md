# last-ts codesplit

**Status:** plan — owner locks below (2026-08-02)  
**npm:** `last-ts@0.0.0` reserved · code name **Last.ts**  
**Repo:** same-workspace `packages/last-ts` first; `hyperlink-ts` depends on it  
**Not this plan:** bare `last.ts` / `last-js` (npm similarity blocks); scoped `@nikolasstow/last.ts` was unpublished intent

## Locked decisions

1. **Never ship a lie** for path/docgen artifacts — commit gen, emit/watch in dev, CI check; no `string` fallback.
2. **Building blocks → `last-ts`.** Hyperlink site / web / TUI / CLI / Dashboard stay on **`hyperlink-ts`**.
3. **`hyperlink-ts` depends on `last-ts`.** No reverse imports. Zero Hyperlink mentions inside last-ts.
4. **Module layout (Effect-true):** one file = one namespace. No nested `Last.View` bags.
5. **Package root `"."` → `Last` only.** Everything else is a subpath.
6. **`View` exists only on last-ts.** Hyperlink sized chrome is a different namespace (**`Ui`**).
7. **Card / Detail / Page sizes + shared size base → Hyperlink `Ui`.** Not in last-ts.
8. **File-router `Page` (marks) → last-ts.** Unrelated to dashboard size `Ui.Page`.
9. **GroupNav + Group-aware compose / Target helpers → hyperlink** (v1). last-ts Route is catalog-only.
10. **Docgen + vite/path codegen** ship with last-ts (tools), not a separate npm package for now.

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

| Subpath | Namespace | Role |
|---------|-----------|------|
| `.` / `./Last` | `Last` | Generic web tools (flat exports; v1 contents TBD) |
| `./View` | `View` | DI kernel only: Tag, Prototype, provide, Registry, layer/base, generic react |
| `./Route` | `Route` | Catalog: make/get/group/match/urlBuilder/fileRoot — **no** Group Target chrome |
| `./Router` | `Router` | memory/history/Provider/Link/Outlet |
| `./Router/waku` | *(waku module)* | Waku layer adapters |
| `./Page` | `Page` | File-router marks: static/dynamic/build/layout, stampOf |
| `./vite` | *(plugin)* | fileRouter emit/watch + check helpers (+ published bin later) |
| `./docgen` (+ modules) | per-file | Move from `docs/docgen` |

```ts
import * as Last from "last-ts"
import * as View from "last-ts/View"
import * as Route from "last-ts/Route"
import * as Router from "last-ts/Router"
import * as Page from "last-ts/Page"
import { fileRouter } from "last-ts/vite"
```

**Not in last-ts:** `ViewKind`, `Card`/`Detail`/`Page` sizes, `SizeChrome`, GroupDash, dashboard `compose`, family views, Observe packs, GroupNav, any `hyperlink-ts` import.

## `hyperlink-ts` UI surface (after cut)

| Subpath | Namespace | Role |
|---------|-----------|------|
| `./ui/Ui` | `Ui` | Size chrome: `Card` / `Detail` / `Page` + shared base; built on `last-ts/View` |
| `./ui/GroupNav` | `GroupNav` | Group tree nav |
| `./ui/*View` | family | WorkPoolView, DaemonView, … (`extends Ui.Card.Tag` etc.) |
| `./ui/DashboardViews` | `DashboardViews` | Merged contributions |
| `./web`, `./tui`, `./cli` | platform | Batteries Dashboard, Ink, CLI |

```ts
import * as Ui from "hyperlink-ts/ui/Ui"
import * as View from "last-ts/View" // only if minting unsized Tags

class PoolCard extends Ui.Card.Tag<PoolCard>()("…") {}
```

Cutover rename: `View.Card` → `Ui.Card`, `View.Detail` → `Ui.Detail`, `View.Page` → `Ui.Page` (size). File-router stays `Page.*` from last-ts.

Optional temporary re-exports on `hyperlink-ts/ui/Route` etc. during migration — drop when callers moved.

## Move / strip checklist

| Today | Action |
|-------|--------|
| `src/ui/Page`, `src/vite/fileRouter`, `internal/fileRouterPaths` | → last-ts |
| `docs/docgen` | → last-ts/docgen |
| `src/ui/Route` catalog | → last-ts; Target/viewOf/memberOf → hyperlink (`GroupNav` or `ui/RouteTarget`) |
| `src/ui/Router`, `RouterWaku` | → last-ts |
| `src/ui/View` kernel | → last-ts/View |
| `src/ui/View` sizes + compose/GroupDash/bind/only | → `hyperlink-ts/ui/Ui` |
| Family views, packs, data, DashboardViews, GroupNav | stay hyperlink |
| `web` / `tui` / `cli` | stay hyperlink |

## Eng phases

| Phase | Work |
|-------|------|
| **P0** | `packages/last-ts` workspace skeleton; root `Last.ts` stub; peers; CI build |
| **P1** | Page + vite/path codegen + docgen move; example `paths:check`; hyperlink depends |
| **P2** | Route/Router move; Target helpers stay/move to hyperlink |
| **P3** | View kernel → last-ts; `Ui` module on hyperlink (Card/Detail/Page + base); rename call sites |
| **P4** | Drop shims; docs/guides; changesets for both packages |

## Open (next locks)

- Exact **v1 members of `Last`** (flat tools — what ships day one vs empty namespace + TSDoc).
- Whether `atom-react` / RegistryProvider lives under last-ts or hyperlink.
- Publish cadence for last-ts beyond `0.0.0` placeholder.
- `Page.Tag` + docs-site createPages (product follow-ons on last-ts/Page).

## Related

- [file-router prototype](../handoffs/file-router-prototype.md)
- [view-page-naming](../handoffs/view-page-naming.md)
- [file-router guide](../guides/file-router.md)
- Module layout: `.cursor/rules/module-layout.mdc`
