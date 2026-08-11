# Agent-invented API audit (owner review)

**Date:** 2026-08-11 (corrected)  
**Branch:** `cursor/agent-k-page-route-6d0e`  
**Purpose:** Inventory of unapproved / host-leaked / stale-taught surfaces agents put in last-ts and dogfood. **Not a go to Eng** — owner picks deletes.

SSOT bans: [`last-ts-api-corrections.md`](./last-ts-api-corrections.md).  
Already removed this turn: spine + Last-site `waku.server.tsx` / `_root.tsx`; teaching of app `createPages` in spine docs.

---

## Owner correction (do not delete)

| Surface | Status |
|---------|--------|
| **`group.fromEffect` / `group.from`** | **Core public API** (HttpApi dual). fileRouter / `Route.fileRoot` is built on it. |
| **`Route.fileRoot` / path-table → group** | **Intended product bridge** — path table into the catalog via `fromEffect`, not the banned Page-class `*FromPages` merge. |

**Confusion to avoid:** Corrections banned top-level **`Route.fromEffect` / `fromPage` / `*FromPages`** (Page-class catalog bake invented on the branch). That is **not** `Group.fromEffect`. Agents must not lump them together again.

---

## Delete / stop teaching now (still present)

| Surface | Where | Why |
|---------|--------|-----|
| **`last-ts/server` public export** (`createPages`, `adapter`, `fromPage`) | `packages/last-ts/src/server.ts`, `package.json` `./server` | Waku host re-exports sold as product. Corrections: not product. |
| **`docs/site/src/waku.server.tsx`** + **`pages/_root.tsx`** | Hyperlink docs site | Same createPages/createRoot/fromPage dogfood as deleted spine. |
| **`docs/last/rsc-router.md`** | Full `Server.adapter(createPages…)` sample | Teaches forbidden host API as Last RSC recipe. |
| **`packages/last-ts/README.md`** | Imports `createPages` / `adapter` | Package front door teaches host glue. |
| **`docs/last/site/README.md`**, **`last-ts-site-framework.md`**, guide comments | Still claim `waku.server` + `Server.fromPage` as Eng’d shape | Stale after spine delete. |
| **`docs/guides/file-router.md`** lines that point at **`Server.fromPage`** | Host list teaching | Kill host teaching only — keep `fileRoot` / `fromEffect` teaching. |
| **`(yield* Page.Document).set`** | `View.tsx` JSDoc `@example` on `View.effect` | Explicitly banned (page-document-lock). |
| **`Page.Document` + `.set` in live island** | `docs/site/src/islands/router-page-demo.ts` | Same ban, running on docs site. |
| **`Page.stampOf` / `Stamp` / `renderModeOf`** | `Page.ts` (`@deprecated` but `@public`) | getConfig/stamp-era introspection; corrections ban that family. |
| **Spine / Last-site `_layout.tsx`** | `pages/_layout.tsx` | Waku createLayout leftover; not `Layout.make`. |

---

## Demote to internal (public today, should not be app surface)

| Surface | Where | Why |
|---------|--------|-----|
| **`./Router/waku` package export** | `package.json` | Duplicate of `last-ts/Waku`; corrections: transport is `Waku` only. |
| **`Waku.binding` / `setDefault` / `Waku.Provider` / object `layer = { waku }`** | `Waku.ts` / `Router/waku.ts` | Extra providers + object-as-namespace engine. |
| **`Last.app` / `router` / `withRouterInstall` / `toProvider`** | `Last.ts` (deprecated) | Nested-provider era; lock is one `Last.provider`. |
| **`Router.memory` / `history` / `unsafeService` / legacy `Router.Provider`** | `Router.ts` | Prefer Memory/History/Waku + Last.provider. |
| **`last-ts/vite` dump** (`discover`, `emitPaths`, `runSync`, …) | `vite/fileRouter.ts` exports | Lock approves `fileRouter` plugin; not the whole CLI surface as app API. |
| **`RouterBuilder.resolveHandler` / `resolveRender`** | public module | Marked internal, still exported. |
| **`Document.applyDocumentArgs`**, **`Layout.toComponent` / `OutletProvider` / `Override*`**, **`Page.remintStatic`** | various | Plumbing on public modules. |
| **`Page/react` bridges** (`DocumentRoot`, `RequestProvider`, …) | `Page/react.tsx` | Soft-nav host bridges; not locked as app API. |

---

## Needs owner call (public / taught, lock missing or conflict)

| Surface | Notes |
|---------|--------|
| **`Page.Document` service (deprecated)** | Half-alive; document-lock bans `.set` teaching. |
| **`View.effect` + huge View.Prototype / annotations / Chrome** | View.make redesign parked; `Service` still under `make`. |
| **`Last.provide` / `toLayer` (ShellMeta-style)** | Superseded as title story by Document; still public. |
| **`Waku.fromApi`** | No lock; invented for RSC soft-nav-only. |
| **`AtomReact` public export** | No Last lock; provider lock says don’t teach nested RegistryProvider. |
| **`docgen/*` public exports** | No Last owner lock in the set. |
| **`RootLayout` / `Layout` `.Component` field** | Needed for host FC; teaching as app wrapper banned. |
| **working-agreement vs spine** | Standard still greylists `waku.server.tsx` filename; spine forbids teaching it. |
| **page-document-lock “Eng’d `_root`” claim** | Stale vs current spine. |
| **file-router-lock “no auto-merge into Router.make”** vs **`Route.fileRoot`** | Align lock prose with owner intent: path-table → `group.fromEffect` is the build path; banned is Page-class `*FromPages` only. |

---

## Confirmed gone from `packages/last-ts` code

`getConfig` · `pageConfig` · `Page.asDefault` · `modeOf` / `optionsOf` / `extract` / `paramBags*` / `configOf` · `*FromPages` / `fileRootFromPages` / `pagesByIdFromModules` (only ban/docs mentions).

**Still present and wrong as product:** `Server.fromPage` (host-side revival).  
**Still present and correct:** `group.fromEffect`, `Route.fileRoot`.

---

## Highest-priority remaining offenders (same class of fuckup)

1. Hyperlink **`docs/site` `waku.server.tsx` + `_root.tsx`**
2. **`docs/last/rsc-router.md`** + **last-ts README** teaching `createPages`
3. **Banned `Page.Document.set`** in `View.tsx` JSDoc + **docs-site island**
4. **`./server` and `./Router/waku` still in package.json exports**

Owner: say which rows to delete/demote; do not Eng from this list without an explicit go.
