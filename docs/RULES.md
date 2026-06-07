# RULES — `@nikscripts/effect-pm`

## TypeScript

- Full strict suite is on; do not loosen it.
- `noUncheckedIndexedAccess`: indexed access is `T | undefined`. Handle the `undefined` branch. Never `!`-assert it away.
- No unsafe casts. No `as any`, no `as unknown as X` to silence the checker. Narrow with predicates, `Schema`, `Option`, or typed APIs.
- Fix all issues, always. Everything is your problem — what you touch can ripple further, so don't limit yourself to the files you edited. Use smaller, scoped typechecks and tests during active work, but verify the whole project is good before you finish.
- `pnpm run typecheck` runs two configs: `tsconfig.json` (src/test/examples) and `tsconfig.src.strict-effect-provide.json` (`src/**` with `strictEffectProvide`). New `src` code must pass both.
- Do not enable `anyUnknownInErrorContext`, and do not write code that relies on it being off.

## Effect language-service diagnostics (hard build failures)

- No raw globals/Node builtins in Effect code. Use Effect services: `Clock`, `Random`, `Console`, `HttpClient`, `DateTime`, `Config`, platform services. (Covers console, date, random, fetch, timers, `process.env`, `crypto.randomUUID`, node builtins, global Error in catch/failure.)
- No raw async/promises inside Effect: no `async function`, `new Promise`, lazy promise in `Effect.sync`, `try/catch` in `Effect.gen`, running an Effect inside an Effect.
- Errors use `Data.TaggedError` / `Schema.TaggedError`. Never extend native `Error`.
- `Effect.gen` uses bare `yield*` (no `_`/`$` adapter). No unnecessary `Effect.gen`, no nested gen yield, no returning an Effect from gen.
- Prefer functional piping over `Effect.gen` / `Effect.fn` wherever reasonable — but not everywhere. No unnecessary `pipe` / pipe chains; take pipeable opportunities.
- Use map/flatten/void hygiene (`effectMapFlatten`, `effectMapVoid`, `effectInVoidSuccess`, `effectSucceedWithVoid`).
- Layer/Context: no multiple `Effect.provide`, no leaking requirements, declare service dependencies, no scope in layer effect, no generic Effect services.
- Schema-first: prefer `Schema` over JSON; correct schema tag/union/instance usage.
- Deterministic keys; strict boolean expressions; no duplicate package; no outdated API.
- `serviceNotAsClass` is off only for service class factories where we duplicate `Context.Service` / `Context.Tag` for our own factories. Any other use is prohibited.
- If a diagnostic is wrong for a line, that is an owner decision — not an inline disable or a cast.

## Verifying Effect errors

- Editor LSP (`@effect/language-service`) shows the same diagnostics inline.
- `pnpm run typecheck` is authoritative (fails on type errors and language-service diagnostics).
- Type-level tests live in `test/*.test-d.ts` using `// @ts-expect-error`; checked by `typecheck`, not Vitest. A public type/error-channel change ships with a `.test-d.ts` assertion.
- Runtime failure behavior is tested in Vitest with `Exit`/`Cause` and `_tag`, not stringified messages.

## Effect usage

- Be modular: import narrow modules from `effect`. If Effect exports it, prefer it over hand-rolling.
- Prefer existing local patterns/services over new ad-hoc abstractions; match neighbouring modules.
- Use Effect platform/node services, not raw `node:*`. If no service exists for a primitive, isolate the Node API behind a small Effect-returning helper.
- Attach dependencies via a built `Context` (`Effect.provide(effect, context)`) or `ManagedRuntime` at OS edges. Don't scatter `Effect.provide(layer)` through internals.
- `repos/effect/` is read-only reference. Never import from `repos/`; never edit it.

## Naming

- A file's name always matches its primary export.
- PascalCase is exclusive to Namespaces, Classes, and Types. camelCase for everything else (functions, consts, factories, facades).
- `Process.ts` (namespace), `RunResourceStore.ts` (class), `storeTransport.ts` (const facade).
- Tags: `Context.Service` class named `<Thing>Tag` or `<Thing>Store`; tag id `@nikscripts/effect-pm/<Module>/<TagName>`.
- Archive facets `<Domain>Store`; telemetry `<Domain>Telemetry`; projections `<Domain>Projection`; scopes `<Domain>Scope`.
- Errors are `Data.TaggedError` / `Schema.TaggedError` subclasses named `<Verb><Noun>Error`.
- Canonical runtime ids are slash-separated `@scope/Segment/ServiceName`.

## File & directory structure

- Root `src/` is newcomer-facing; if someone starting out reaches for it directly, it lives at `src/`.
- Role folders only (`store/`, `transport/`, `state/`, `sink/`, `storage/`, `internal/`). No domain subfolders.
- No legacy, no shims. When a symbol moves, update every import in the same change.
- Examples: one API shape per file in `examples/forms/<area>/`; compositions in `examples/scenarios/`; shared doubles in `examples/shared/`.

## Module layout

- Open large/public modules with a TSDoc `@module` (or `@packageDocumentation` for `index.ts`) overview: what it is, a forms/presets table, a usage snippet.
- Delimit regions with section banners (`// ===` blocks).
- Order: module doc → imports → public types → service tag/class → internal helpers → public factories/presets → namespace assembly + exports.
- Named imports from `effect` grouped together; local imports by relative path. No deep imports into other packages' internals.

## Exports

- A public surface lives under a namespace in its module; `src/index.ts` re-exports the same bindings under short names. Both must be identical.
- `src/index.ts` is grouped by domain with comment headers; keep new exports in the right group.
- Separate `export { ... }` (values) from `export type { ... }` (types).
- New standalone import surface = three edits: namespace + barrel re-export, `tsup` entry, `package.json` `exports` subpath (`types`/`import`/`require`).
- Never export `src/internal/**`; it gets no subpath.

## Documentation & comments

- Everything exported gets TSDoc so consumers get a hover description. At minimum one sentence of intent; add `@example`, `@param`, `@remarks`, `{@link}` where useful. Mark audience with `@public` / `@internal`.
- Comments are part of the code's flow: narrate intent and the why; explain non-obvious type-level/layer-order/runtime-ownership plumbing, trade-offs, and invariants. No redundant restate-the-obvious comments.
- Regular docs and source TSDoc describe implemented behavior; `docs/plans/*` is future-only. Cross-link with relative paths.

## Formatting

- 2-space indent, double quotes, semicolons, trailing commas in multiline literals.
- ESLint flat config over `src`/`test`/`examples`: `no-explicit-any` off, `no-namespace` off, `no-unused-vars` error with `_`-prefix allowed.
- `repos/**` and `dist/**` are exempt.

## Testing

- Vitest via `pnpm test`; `@effect/vitest` for Effect-aware tests.
- Use `TestClock` for anything schedule/polling/backoff — never real timers.
- `test/<area>.test.ts` for runtime; `test/<area>.test-d.ts` for type-level; `test/*.conformance.ts` for shared adapter suites.
- New facet tests mirror `test/run-resource-store-facet.test.ts`; new adapters run the conformance suite.
- Assert error channels via `Exit`/`Cause` and `_tag`.

## Public vs internal

- Public = apps import it (`@nikscripts/effect-pm`, a documented subpath, or a bin entry); lives under `src/` with a documented export.
- Internal = only package modules use it; lives under `src/internal/`, never exported, no subpath.
- Storage facets are public under `src/store/` with `store/<Domain>` subpaths. See `.cursor/rules/public-vs-internal.mdc`.

## Git & change management

- Commit/push frequently on agent branches.
- Never commit/push to `main`, `develop`, release branches, or user-created branches without explicit approval.
- A changeset is required when public API, behavior, package metadata, or release notes change; creating/editing one needs user approval.
- No `git config` changes; no destructive/force operations unless explicitly requested.

## Vendored repos

- `repos/` is read-only upstream reference. Inspect for idiomatic patterns before inventing. Never import from it; never edit it unless explicitly asked.
