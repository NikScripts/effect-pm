# last-ts — CMS tree types → `fromEffect`

**Run:** `pnpm run example:last-from-effect`

The show is **`cms.ts`**: a const CMS AST with

- **conditional** `SiteTree<Features>` (`variants` / `docs` flip leaves + branches)
- **recursive** `UrlsOf` (`docs.api.symbol`)
- **narrow** path params (`locale: "en" | "de"`, `version: "v1" | "v2"`) + query bags

`main.ts` walks those trees inside `group.fromEffect` / `groupsFromEffect` and
plugs them into `Router.make().add`. Bake `R` is `CmsEdition`.

Type fireworks: `test/ui-from-effect-typed.test-d.ts`.
