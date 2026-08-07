# Last.ts site — adopt the framework

**Branch:** `cursor/file-router-prototype-125f`  
**Status:** Eng — phases 1–4 (Page / RouterBuilder demo)  
**Goal:** Run `docs/site` on last-ts View / Router / Page patterns, then migrate
hyperlink-ts product UI onto the same spine.

## Why

The docs site is the dogfood surface. Hyperlink dashboard/TUI follows once the
site is green on:

- `View.Service` (+ positional `default` slots)
- `View.mount` / `View.effect`
- `Router` + `RouterBuilder` + `Memory`/`History`/`Waku`
- `Page.Request` / `Page.Document`
- Layout = `children` (no Outlet-as-service)

## Phases

1. **Slots demo — Eng’d** — Sidebar default + override island on the View guide
   (`view-sidebar` fence → `ViewSidebarIsland`).
2. **Book chrome — Eng’d** — `docs/site/src/ui/bookChrome.ts` exposes
   `BookSidebar` as `View.Service(key, default)`; `MainBook` / `StandardsBook`
   mounts; `(book)/_layout` uses `BookSidebarIsland` (standards swap via
   `Effect.provideService`). Presentational `.nav-*` anchors in the slot;
   soft-nav / collapse stay on mobile `GroupedNav`.
3. **Router catalog — Eng’d (Router.make)** — `siteRoutes` uses
   `last-ts/Router.make` + `last-ts/Route.get` (was `hyperlink-ts/ui/Route`).
   Waku skin unchanged (`hyperlink-ts/ui/Router/waku` → `last-ts/Router/waku`);
   site `Outlet` remains no-op (file routes = render / Twoslash SSOT).
   **Deferred:** `RouterBuilder` handler registration — only when a demo leaves
   file-route bodies for Effect page handlers.
4. **Page marks — Eng’d (demo)** — `router-page` island on Routing guide:
   Memory + `RouterBuilder` with Effect home (`Page.Request` / `Document`) and
   JSX about; `Page.static` stamp asserted in vitest. Full Waku cutover onto
   `Page.*` marks / `fileRouter` still open.
5. **Hyperlink migrate** — dashboard/TUI consume the same last-ts modules (no
   parallel View masks).

## Non-goals (yet)

- HttpApi-shaped View catalogs
- Full cutover of every island in one PR
- `pnpm run version` / publish
- Replacing Waku file routes with `RouterBuilder` for the whole book

## Verification

- `pnpm -C packages/last-ts typecheck`
- `pnpm exec vitest run test/view-service-default.test.ts`
- `pnpm -C docs/site exec vitest run test/book-chrome.test.ts test/router-page-demo.test.ts`
- `pnpm run docs:serve` — View sidebar + book chrome + Routing `router-page` island
