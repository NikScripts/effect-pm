# Agent-invented API audit (owner review)

**Date:** 2026-08-14 (updated)  
**Branch:** `cursor/agent-k-page-route-6d0e`  
**Purpose:** Inventory of unapproved / host-leaked / stale surfaces. Eng progress noted.

SSOT bans: [`last-ts-api-corrections.md`](./last-ts-api-corrections.md).

---

## Eng’d this cut (gone / demoted)

| Surface | Status |
|---------|--------|
| View brand theater (`Component` / `Unresolved` / peels / handles / `AnyView`) | **Deleted** — `View` ≡ `ViewFn` |
| `View.mount` / `View.stamp` / `Last.app` / bag `toLayer` | **Deleted** earlier |
| Page stamp helpers (`stampOf` / `Stamp` / `renderModeOf`) | **Deleted** |
| Public `RouterClient`, `RouterBuilder.resolve*`, `Document.applyDocumentArgs`, `Page.remintStatic` | **Deleted / demoted** |
| Package export `./server` | **Removed** — host `createPages` is Waku host wiring |
| Package export `./Router/waku` | **Removed** — use `last-ts/Waku` |
| `Waku.setDefault` / `Waku.Provider` / `binding` public | **Dropped** — `Last.provider(Waku.fromApi\|layer)` |

---

## Owner correction (do not delete)

| Surface | Status |
|---------|--------|
| **`group.effect` / `group.from`** | **Core public API** (HttpApi dual). Was `fromEffect`. |
| **`Route.fileRoot` / path-table → group** | **Intended product bridge** |

---

## Still needs attention

| Surface | Notes |
|---------|-------|
| Stale guides teaching createPages / `View.mount` / `getConfig` | Scrub remaining prose |
| Lite `Router.memory` / `history` / `unsafeService` / `Router.Provider` | Dashboards still use; prefer Memory/History/Waku + `Last.provider` |
| `Page.Document` legacy service | Prefer `Page.document` + `Document.*` |
| `View.Prototype` / annotations | Hyperlink size chrome depends — keep until redesign |
| `AtomReact` public / `Waku.fromApi` / docgen | Owner call if demote |
| Hyperlink `Chrome` / `SizeChrome` | Intentional on hyperlink-ts |

---

## Keep (locked)

`Last.provider` / `context` / `use` / `provideContext` / `link` / `provide` · `View.make` · Page/Document/Layout mint · Route catalog + `group.effect` / `fileRoot` · Memory/History/Waku layers · `last-ts/vite` `fileRouter` · `last-ts/config`
