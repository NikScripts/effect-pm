{#verify-red-2026-08-21 title="Green gate is red — UI / Last surface" status="active" appliesTo=process}
# Green gate is red — UI / Last surface (2026-08-21)

`pnpm verify` exits **1 at typecheck**, so `lint`, `test`, `build`, `markers`, and `file-router`
never run. Anything landed since it went red was landed against an unverified repo.

``` sh
pnpm verify
# → EXIT=1, fails in checks.typecheck() before any later stage
```

## Per-project counts

Each line is `tsgo --noEmit -p <project>`, counting `: error TS` only (the 649 `TS377032`
strict-provide advisories are excluded).

```
 92  tsconfig.json
  9  tsconfig.src.strict-effect-provide.json
 71  src/ui/tsconfig.json
172  src/web/tsconfig.json
103  src/tui/tsconfig.json
  0  packages/last-ts/tsconfig.json
```

`packages/last-ts` on its own is green. The failures are where it meets the Hyperlink UI surface.

## Where the errors are

```
14  test/ui-routes.test-d.ts
11  test/ui-routes.test.ts
 9  test/ui-routes-from-effect.test-d.ts
 9  src/internal/groupAsRoutes.ts
 8  test/ui-router-mini-docs.test-d.ts
 6  examples/ui/router-mini-docs.ts
 5  packages/last-ts/src/Last.ts
 5  test/ui-from-effect.test.ts
 4  packages/last-ts/src/internal/hostPage.ts
 3  test/ui-file-router.test-d.ts
 3  packages/last-ts/src/View.tsx
 …  remainder all ui-* / router / page / document / examples/ui
```

Nothing in Address, Node, Hyperlink core, WorkPool, Daemon, Gate, Store, or Lookup.

## The shape of it

All nine `strict-effect-provide` errors are one file, and they are the same mismatch repeated — a
`PageEndpointBrand`-tagged `HttpApiEndpoint` not assignable to `Route.Endpoint`:

``` text
src/internal/groupAsRoutes.ts(98,10): error TS2345: Argument of type
  'HttpApiEndpoint<string, "GET", `/${string}`, …, toCodecJson<Page>, …> & PageEndpointBrand'
  is not assignable to parameter of type 'Endpoint<string, `/${string}`, never, never>'.
```

``` text
src/internal/groupAsRoutes.ts(63,53): error TS2344: Type '{ readonly nodeId: string; }'
  does not satisfy the constraint 'Top'.
```

The second is a `Schema.Top` constraint — a plain object where a Schema is expected.

## Ownership

`src/internal/groupAsRoutes.ts` is the Group → `ui/Route` bridge. Its recent history is entirely
Last work:

```
6739041d refactor(last-ts): Last.provide edge fulfill; group.effect
63c0a3d8 feat(last-ts): resolve group.from(Service) + flat Group.asRoutes
75b31581 feat(last-ts): finish codesplit — Route, Router, View, docgen
e8b9e8cf refactor(ui): Router/Target/PathToken _tag cutover
```

Owner call (2026-08-21): **this is not Agent 6's surface.** Recorded here so it is visible rather
than rediscovered, and so nobody reads a scoped or partial check as "green".

## Rule this violates

``` text
{#green-before-commit} The repo green gate passes before anything is committed or released — no
exceptions … Red on any of them means it isn't done.
```

A red gate must not be synced. While it is red, no change to `src/` should land on a shared branch,
and no partial run — `vitest run <file>`, a single `tsgo -p` — may be reported as green.

## Reproduce

``` sh
node_modules/.bin/tsgo --noEmit -p tsconfig.src.strict-effect-provide.json
node_modules/.bin/tsgo --noEmit -p src/ui/tsconfig.json
```
