# File router (owner lock)

**Status:** LOCK + Eng’d on `cursor/agent-k-page-route-6d0e`  
**Package:** `last-ts` (`vite/fileRouter`, `internal/fileRouterPaths`)  
**Related:** [`page-mint-lock.md`](./page-mint-lock.md) · [`last-ts-api-corrections.md`](./last-ts-api-corrections.md) · guide [`../guides/file-router.md`](../guides/file-router.md)

## One-sentence lock

**`fileRouter` emits a path-only typed table (`paths.gen.ts`). It is not the HttpApi catalog, not host registration, and not Page mint mode.**

## Guarantees

| Guarantee | Detail |
|-----------|--------|
| Path table | `{ id, filePath, routePath }` + closed unions `FilePath` / `RoutePath` / `FileRouteId` |
| Disk → Route | `[param]` → `:param`; `[...name]` → `*name` |
| Groups | `(name)` segments stripped from URL paths (`(book)/docs/x` → `/docs/x`) |
| Emit / check | Vite plugin emit; `hyp file-router check` proves gen ≡ disk |
| Cold start | Committed `paths.gen.ts` usable without Vite |

## Non-guarantees (forbid teaching as product)

- Mode / staticPaths / stamps in codegen
- Auto-merge into `Router.make` / `Route.get({ params })`
- Auto-`createPages` / Page-class catalog bake
- Silent widen to `string` when gen is missing

## App surfaces stay hand-authored

| Surface | Owner |
|---------|--------|
| Soft-nav catalog | `Router.make` + `Route.get(…, { params })` |
| Host registration | `Server.fromPage(path, mint)` (+ `staticPaths` when needed) |
| Page body | `Page.make` / `Page.static` (path from file only) |

Align catalog ids/paths with `paths.gen` by hand (or a local `Expect` type test). Do **not** invent `*FromPages` merge APIs.

## Host vs typed catalog (route groups)

Waku layout matching may keep `(book)` in **host** `createPage` / `createLayout` path prefixes. The **file-router table** strips groups so app `urls.*` / soft-nav see served URLs only. Both are correct; do not “fix” host paths to drop groups without checking layout attachment.

## CI

Dogfood trees that ship the plugin must stay in sync:

```bash
pnpm hyp file-router check --pages examples/last/spine/src/pages --out examples/last/spine/src/paths.gen.ts
pnpm hyp file-router check --pages docs/last/site/src/pages --out docs/last/site/src/paths.gen.ts
pnpm hyp file-router check --pages docs/site/src/pages --out docs/site/src/paths.gen.ts
```

## Forbidden

- Catalog-merge / Page introspection bake APIs (corrections lock)
- Teaching `paths.gen` as the Router product
- Path argument on `Page.make` / `Page.static`
