# Type-display cleanup — shipped state + remaining backlog

**For:** the engineer continuing resource-handle type-display work.
**Owner protocol:** engine changes land on an engine branch (off `integration/storage`); plan first, show Before/After, nothing merges without a go. Never sit on an integration branch.

## What shipped (committed on `docs/twoslash-hover-types`)

`yield* SomeTag` used to hover as an unreadable wall (`Method<…>` descriptors, `Schema.Struct.ReadonlySide<…>`, a union where overloads belonged). Now the handle reads as its real shape. All green (`typecheck 0 / lint 0 / test 456`), cast-free.

- **`Simplify` on `ServiceOf`** — resolves each member from the `Method<…>` spec descriptor to its real effect (`add: (payload) => Effect<void>`, `size: Subscribable<number>`).
- **`PrettifyPayload`** — resolves the schema's decoded `.Type` alias to `{ to: string }` and drops the schema `readonly`, at the payload position.
- **`Client<T>` override API** (the two-stage constructors) — a method's *client-facing* type can be overridden without touching wire/impl (which stay schema-derived). `Method` carries a phantom `Client` type param (`Derive` = derive-from-schema); `ServiceOf`'s leaf reads it. Forms:
  - `effectFn(schema)` / `effect(success)` — single-stage, derived (unchanged; existing calls untouched).
  - `effectFn<T>()(schema)` / `effect<Effect<T>>()(success)` — two-stage, **narrowing** override: `T` must be assignable to the schema-derived shape (add overloads / refine, but a `T` that accepts payloads the wire rejects makes the arg resolve to `never` — compile error).
  - `unsafeEffectFn<T>()(schema)` / `unsafeEffect<Effect<T>>()(success)` — two-stage, **free** override (no check). For a generic library whose correct override is unprovable under `<F>` — this is why the **queue** `add`/`prioritize`/`defer` use `unsafeEffectFn<{ (item); (items[]); (union) }>()(itemOrItems)` and read as real overloads.
  - `Resource.Decoded<S>` — a schema's prettified `.Type`, for spelling a clean override (`{ to: string }`, resolves at the concrete call site).
  - A void query is now written explicitly `effect(Schema.Void)` (freed the empty `effect()` to be the two-stage entry).
- **Dropped the `Kind` type param** — `Method<P, Su, E, Str, Ann, Client>`; `kind` ("query"/"mutate") is a runtime-only field (still stamped, still in `getMethodMeta`). It carried no type info (redundant with payload-presence). `Method<…>` hovers no longer show "query"/"mutate".

## Remaining backlog

1. **Nested entry `item`** — the entry-carrying verbs (`enqueue`/`release`/`deadLetter`/`drop`) take a `QueueEntry`, whose nested `item:` field still shows `Schema.Struct.ReadonlySide<…>`. `PrettifyPayload` is shallow on purpose (a blanket deep recurse broke `CustomQueueResource`'s entry contract, and `DateTime.Utc` expands into ugly absolute `import("/…/DateTime")` paths). Fix targeted: clean `item` at the `QueueEntry` **schema-type** (`queueEntry`/`queueEncodedEntry` in `src/QueueResource.ts`), or a display-only path that doesn't feed the shared contract. Acceptance: `item` reads `{ to: string }`, `DateTime.Utc` stays intact, `typecheck + test` green.
2. **Other resources' enqueue-style verbs** — `Process` / `RunResource` / `ApiMetrics` methods with an `X | ReadonlyArray<X>` payload can get the same overloads via `unsafeEffectFn<…>()` (or `effectFn<…>()` where the concrete narrowing holds).
3. **Sweep verbose public types** — status/metrics/config structs, etc. Prefer `PrettifyPayload`/`Decoded`; escalate to a targeted schema-type fix only where a shared contract forbids the blanket transform.

## Verifying a hover — caching gotchas (these cost real hours)

- The **editor** resolves `@nikscripts/effect-pm/*` via `package.json` exports to **`dist/*.d.ts`**, not `src`. After every `src` change: `pnpm build` **and** restart the TS server, or you see stale types. (Beware stale copies: `short-box/node_modules/@nikscripts/effect-pm` (Oct 2025) and the `effect-pm-alt` checkout.)
- **Headless probe** (no editor) — TS compiler-API resolving to dist: `paths: { "@nikscripts/effect-pm": ["dist/index.d.ts"], "@nikscripts/effect-pm/*": ["dist/*.d.ts"] }` → `ls.getQuickInfoAtPosition(...)` (mirrors the editor hover) or `checker.typeToString(getTypeAtLocation(<the `const x = yield* Tag` name>), …, NoTruncation)`.
- The **docs** twoslash resolves to **`src`** (its own compiler `paths`), but the running dev server's twoslash language-service **caches per-process** — restart 5190 to refresh; the dev server sends no cache headers so the browser serves stale HTML — load `http://<host>:5190/?v=N` to bypass.
- **Named vs inline display:** a *named* type alias hovers as its name (hides the shape); an *inline* structural type expands. That's why overrides must be spelled inline (via `Resource.Decoded<S>`), not behind a named helper — a named helper reintroduces the hiding.
