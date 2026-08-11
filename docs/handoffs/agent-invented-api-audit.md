# Agent-invented API audit (owner review)

**Date:** 2026-08-11  
**Branch:** `cursor/agent-k-page-route-6d0e`  
**Purpose:** Inventory of unapproved / host-leaked / stale-taught surfaces agents put in last-ts and dogfood. **Not a go to Eng** — owner picks deletes.

SSOT bans: [`last-ts-api-corrections.md`](./last-ts-api-corrections.md).  
Already removed this turn: spine + Last-site `waku.server.tsx` / `_root.tsx`; teaching of app `createPages` in spine docs.

---

## Delete / stop teaching now (still present)

| Surface | Where | Why |
|---------|--------|-----|
| **`last-ts/server` public export** (`createPages`, `adapter`, `fromPage`) | `packages/last-ts/src/server.ts`, `package.json` `./server` | Waku host re-exports sold as product. Corrections: not product. |
| **`docs/site/src/waku.server.tsx`** + **`pages/_root.tsx`** | Hyperlink docs site | Same createPages/createRoot/fromPage dogfood as deleted spine. |
| **`docs/last/rsc-router.md`** | Full `Server.adapter(createPages…)` sample | Teaches forbidden host API as Last RSC recipe. |
| **`packages/last-ts/README.md`** | Imports `createPages` / `adapter` | Package front door teaches host glue. |
| **`docs/last/site/README.md`**, **`last-ts-site-framework.md`**, guide comments | Still claim `waku.server` + `Server.fromPage` as Eng’d shape | Stale after spine delete. |
| **`docs/guides/file-router.md`** | Points at `Server.fromPage` | Host list teaching. |
| **`(yield* Page.Document).set`** | `View.tsx` JSDoc `@example` on `View.effect` | Explicitly banned (page-document-lock). |
| **`Page.Document` + `.set` in live island** | `docs/site/src/islands/router-page-demo.ts` | Same ban, running on docs site. |
| **`Page.stampOf` / `Stamp` / `renderModeOf`** | `Page.ts` (`@deprecated` but `@public`) | getConfig/stamp-era introspection; corrections ban that family. |
| **Spine / Last-site `_layout.tsx`** | `pages/_layout.tsx` | Waku createLayout leftover; not `Layout.make`. |

---

## Demote to internal (public today, should not be app surface)

| Surface | Where | Why |
|---------|--------|-----|
| **`Route.fileRoot` / `Route.fileSystem`** | `Route.ts` → file-router internals | Auto-merge gen → catalog; file-router-lock: no auto-merge into Router. Taught in guides/examples. |
| **`Router.destinations*` / `fileSystem` / related** | `Router.ts` | Same catalog-merge family as banned `*FromPages`. |
| **`group.fromEffect` / `group.from`** | `internal/routes.ts` (still on groups) | Corrections say `Route.fromEffect*` deleted — method still powers fileRoot. |
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
| **`Route.fileRoot` intent** | Guide calls it optional UrlBuilder bridge; lock forbids auto-merge — pick one. |
| **`group.fromEffect` for Hyperlink `Group.asRoutes`** | May stay for Hyperlink UI; must not be Last page-catalog bake. |
| **`Page.Document` service (deprecated)** | Half-alive; document-lock bans `.set` teaching. |
| **`View.effect` + huge View.Prototype / annotations / Chrome** | View.make redesign parked; `Service` still under `make`. |
| **`Last.provide` / `toLayer` (ShellMeta-style)** | Superseded as title story by Document; still public. |
| **`Waku.fromApi`** | No lock; invented for RSC soft-nav-only. |
| **`AtomReact` public export** | No Last lock; provider lock says don’t teach nested RegistryProvider. |
| **`docgen/*` public exports** | No Last owner lock in the set. |
| **`RootLayout` / `Layout` `.Component` field** | Needed for host FC; teaching as app wrapper banned. |
| **working-agreement vs spine** | Standard still greylists `waku.server.tsx` filename; spine forbids teaching it. |
| **page-document-lock “Eng’d `_root`” claim** | Stale vs current spine. |

---

## Confirmed gone from `packages/last-ts` code

`getConfig` · `pageConfig` · `Page.asDefault` · `modeOf` / `optionsOf` / `extract` / `paramBags*` / `configOf` · `*FromPages` / `fileRootFromPages` / `pagesByIdFromModules` (only ban/docs mentions).

**Renamed, not gone:** `group.fromEffect` still exists; `Server.fromPage` is the host-side revival of catalog `fromPage`.

---

## Highest-priority remaining offenders (same class of fuckup)

1. Hyperlink **`docs/site` `waku.server.tsx` + `_root.tsx`**
2. **`docs/last/rsc-router.md`** + **last-ts README** teaching `createPages`
3. **Banned `Page.Document.set`** in `View.tsx` JSDoc + **docs-site island**
4. **`Route.fileRoot` / `group.fromEffect`** still public + taught
5. **`./server` and `./Router/waku` still in package.json exports**

Owner: say which rows to delete/demote; do not Eng from this list without an explicit go.
