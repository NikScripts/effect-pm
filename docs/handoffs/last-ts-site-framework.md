# Last.ts site — adopt the framework

**Branch:** `cursor/file-router-prototype-125f`  
**Status:** Eng start  
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

1. **Slots demo (this tip)** — Sidebar default + override island on the View guide.
2. **Book chrome** — extract nav/sidebar as `View.Service` defaults; page groups
   provide overrides (Standards book swap mirrors nested settings).
3. **Router catalog** — replace ad-hoc `siteRoutes` with `Router.make` +
   `RouterBuilder` for docs/API/search; keep Waku transport via `Waku.layer`.
4. **Page marks** — file-router stamps where pages are file-based; Effect page
   handlers for live demos.
5. **Hyperlink migrate** — dashboard/TUI consume the same last-ts modules (no
   parallel View masks).

## Non-goals (yet)

- HttpApi-shaped View catalogs
- Full cutover of every island in one PR
- `pnpm run version` / publish

## Verification

- `pnpm -C packages/last-ts typecheck`
- `pnpm exec vitest run test/view-service-default.test.ts`
- `pnpm run docs:serve` — View guide island renders default + swap
