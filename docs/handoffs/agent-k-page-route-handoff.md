# Agent K — Page.make / Route / last-ts site handoff

**From:** Agent G (fired mid-turn)  
**Branch:** `cursor/agent-k-page-route-6d0e` (continues `cursor/file-router-prototype-125f`)  
**Base / sync:** base = `integration` (do not open ready PRs / `pnpm run version` unless owner asks)  
**Lock:** [`page-route-make-lock.md`](./page-route-make-lock.md)  
**Guide:** [`docs/last/rsc-router.md`](../last/rsc-router.md)  
**Surface:** `docs/last/site` only (`pnpm run docs:last-site` → `:5220`) — **not** Hyperlink `docs/site`, not example apps

---

## Owner locks (do not reopen)

- Pages are **classes** (HttpApi-shaped), not Services. `Page.make` = dynamic; `Page.static` = SSG.
- Request options = **optional first arg** (same bag as `Route.get`).
- `Route.get` dynamic by default; static via `staticFromEffect` / Literals — **no** manual path lists, no `Literal|String` unions.
- Provider shape only:

```ts
export const Provider = Last.provider(
  Waku.layer.pipe(Layer.provide(routes)),
)
```

- Apps **never** write Waku `getConfig` / invent `Page.getConfig` — Vite `pageConfig()` injects.
- RSC Provider / client islands **must not** import file page modules. Catalog twins from shared options (`chapter.ts`) or path-only rows. Server tooling may use `Router.pagesByIdFromModules(glob)`.

---

## Tip state when handed off

Uncommitted work on the branch (commit this first if still dirty):

| Area | Change |
|------|--------|
| `Route.fileRootFromPages` / `Router.fileSystemFromPages` | Path table + page-class merge as catalog root |
| `Route.WithParamBags` | Public re-export |
| `RoutesOf` / `EntryRoute` | Includes `PageEndpointBrand` so `RouterBuilder.handle` stays page-typed (not Effect API) |
| `docs/last/site` catalog | `fileRootFromPages(fileEntries, { guides_slug })` — ids = `paths.gen` (`index`, `guides_slug`, …) |
| Chapter page | `Page.static(chapterOptions)` → `configOf` emits `staticPaths` |
| Rest dogfood | `pages/docs/[...path].tsx` → `docs_path` / `/docs/*path` |
| Nav / urls | `urls.index()`, `urls.guides_slug(…)`, `urls.docs_path(…)` |
| Docs / lock / changeset | Updated for the above |

**Branch tip:** same as `origin/integration` — run `git rev-parse` (synced).

---

## Verify before continuing

```bash
pnpm exec vitest run \
  test/page-make.test.ts \
  test/page-config-vite.test.ts \
  test/route-from-effect.test.ts \
  test/route-from-page.test.ts \
  test/file-router-rest.test.ts

pnpm exec tsc -p packages/last-ts/tsconfig.json --noEmit
pnpm exec tsc -p docs/last/site/tsconfig.json --noEmit

pnpm run docs:last-site
# curl :5220 / /guides/routing /docs/intro/rest → 200
```

`Page.configOf(Page.static({ params: { slug: Schema.Literals([...]) } }))` must include `staticPaths`.

---

## Known gotchas

1. **`Page.Props<typeof X>` inside `static Component`** → TS7022 circularity. In class body use `Page.PropsFromOptions<typeof options>`; outside use `Page.Props<typeof X>`.
2. **`Schema.Literals` is a function** — `typeof === "object"` misses it in `literalsOf` / `configOf` (already fixed; don’t regress).
3. **fileRouter Vite plugin** — Node FS is async; emit must use `runPromise`, not `runSync`.
4. **`asDefault` brand** — stamp `TypeId` / `options` / `mode` on subclasses or extract breaks.
5. Waku defaults pages to static; dynamic `[slug]` / `[...path]` without inject → 500 — rely on `pageConfig()`.
6. **Waku `pages.gen.ts` typegen** only sees on-disk `getConfig`. Inject is transform-only, so typegen would mark `Page.make` routes `static`. `pageConfig()` also aligns literal `render` rows from `Page.make` / `Page.static` after typegen writes.

---

## Sensible next improvements (pick, don’t boil ocean)

1. ~~Smoke `:5220`~~ — Eng’d (`/` `/guides/routing` `/docs/intro/rest` 200).
2. ~~Confirm vite regen~~ — `paths.gen` stable; `pages.gen` was flipping `docs/[...path]` → `static` (Waku typegen blind to inject). Fixed via `pageConfig` align pass.
3. Optional: server-only assert that `pagesByIdFromModules` ids ⊆ `fileEntries` ids (never import that into Provider).
4. Optional: `layerDestinationsFromPages` sibling of `layerDestinations` if builder catalogs need the merge.
5. Owner-gated: PR land + `pnpm run version` (changeset already at `.changeset/page-make-route-from-effect.md`).

---

## Do not

- Touch Hyperlink `docs/site` for this stack.
- Reintroduce `examples/apps/last-ts-site`.
- Open PRs / run `pnpm run version` without owner.
- Commit on `main` / `develop` / owner branches.

---

## Agent-status row

Replace Agent G with Agent K on `cursor/file-router-prototype-125f`; tip SHA = commit after landing the WIP above; gaps = live smoke + owner PR/version.
