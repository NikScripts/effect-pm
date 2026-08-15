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
| `Router.memory` / `history` / `unsafeService` | **Deleted** — use `Memory.fromApi` / `History.fromApi` / `.service` / `.layer` |
| Public `Page.Document` / `DocumentValue` / `DocumentApi` | **Deleted** — use `Page.document` + `Document.*` |

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
| `Router.Provider` | React mount under `Last.provider`; keep for `useRouter` — apps prefer `Last.provider` |
| `View.Prototype` / annotations | Hyperlink size chrome depends — keep until redesign |
| `AtomReact` public / `Waku.fromApi` / docgen | Owner call if demote |
| Hyperlink `Chrome` / `SizeChrome` | Intentional on hyperlink-ts |
| Outlet-local `useDocument` bridge | Internal read/set bag; product writes stay `Page.document` |

---

## Keep (locked)

`Last.provider` / `context` / `use` / `provideContext` / `link` / `provide` · `View.make` · Page/Document/Layout mint · Route catalog + `group.effect` / `fileRoot` · Memory/History/Waku layers (+ `fromApi`) · `last-ts/vite` `fileRouter` · `last-ts/config`
