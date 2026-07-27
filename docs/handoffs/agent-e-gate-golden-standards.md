# Agent E — bring Gate to the golden standard

> **Naming:** read as WorkPool / Daemon / Gate / Hyperlink / hyperlink-ts (pre-rebrand names purged from this file).

Your job: bring **`src/Gate.ts`** up to the same "golden template" bar that
`WorkPool` (WorkPool) set and `Daemon` now meets. This is a full pass (Gate
is the least-polished of the three), but you have the exact playbook for nearly
every piece — copy the patterns, don't invent.

Work in this repo/worktree. Branch off `integration` (an empty
`gate-golden-standards` branch already exists off the current integration —
use it or recreate it). Merge to `integration` when green.

## Baseline / environment (read first)

- **`effect` is now `4.0.0-beta.98`** (upgraded from beta.92; on integration as of
  the merge that landed this handoff update). `pnpm install` before you start.
- **Green baseline on integration:** full `tsc` **0 errors** (ignore only
  `scratchpad/*` and `test/resource-readiness.test.ts` TS2589); **470/470** tests;
  effect LSP 0/0/0 on every file *except* `Gate.ts` (which has the 3 below).
- **beta.98 gotcha you inherit — `any`-poisoned upstream types hide runtime breaks.**
  The beta.92→.98 bump renamed `HttpApiEndpoint.name`→`.identifier`, but because
  `HttpApiEndpoint.Top extends HttpApiEndpoint<…, any, unknown>`, reading the old
  `.name` typechecked as `any` and **tsc stayed silent** while ApiMetrics silently
  recorded nothing — only the test suite caught it. Lesson for your cast removals:
  a green `tsc` is necessary but not sufficient; **run `vitest` too** (see the
  full-project-typecheck lesson below). Gate itself does NOT touch httpapi,
  so no beta.98 migration is needed inside it.
- **`effect/Optic` (schema-derived optics) is now available** but is **out of scope**
  for this golden-standard pass — don't introduce it here.

## The bar — what "done" means (the WorkPool/Daemon checklist)

1. **Named handle** — `yield* MyGate` hovers as a compact named type, not the
   expanded `ServiceOf<…>` wall. (This is the big missing piece — see below.)
2. **`Tag ≡ Service`** — both forms yield the same handle type.
3. **Casts minimal + each documented or guarded.** WorkPool ended at 2, Daemon at 1.
4. **Effect LSP 0/0/0** — `npx effect-language-service diagnostics --file src/Gate.ts`.
5. **`@public` complete** — every public export tagged (`@public` or `@internal`).
6. **Tree-shake gate green** — the light `Tag`-only path pulls no engine. Add a
   Gate case to `docs/site/scripts/treeshake-check.mjs` if missing.
7. **SSOT** — either derive schema-facing types from the schema (`typeof schema.Type`,
   Daemon's approach) OR hand-author + a `*-type-drift.test-d.ts` guard (WorkPool's).
   No hand-authored duplicate of a schema type without a guard.
8. **No debris** (TODO/FIXME/ts-ignore/console), **tests green**, guide deferred.

## Gate audit — the gap (re-measured 2026-07-14 on beta.98)

Current numbers on integration: **named handle MISSING**, **3** effect-LSP errors
(all `missingEffectContext: unknown` at **510 / 513 / 522**), **32** casts by
`grep -nE "\bas\b" src/Gate.ts | grep -E "as [A-Z]|as unknown|as any|as \{"`
— of which **4 are `as any`** (both in `serve`/`serveRemote`, lines ~669 & ~702:
`tag as any`, `built as any`). Cast breakdown: 6× `as HyperlinkTag`, 5× `as unknown`,
5× `as Layer.Layer`, 4× `as any`, 3× `as {`, 2× each `as Schema.Top` /
`as GateWireSchemas` / `as Hyperlink.AnyMethod`, and 10 singletons. The 4
`as any` in serve/serveRemote map **directly** to WorkPool's already-solved fix — WorkPool
removed the vestigial `built as any` in its own `serve`/`serveRemote`; copy that.

### A. Named handle — MISSING (the M3-equivalent; the substantial piece)
There is **no `Gate<…>` handle interface**; `yield* MyGate` types as the raw
`ServiceOf<RunInstanceSpec<…>>`. Build the named handle the way WorkPool did:
- Author `export interface Gate<Payload, Success, Error, Requirements>` (or
  the right param set for a run — a run is a single tracked effect: `run`, plus
  its controls/events; check `RunInstanceSpec`/`ImplOf<RunInstanceSpec>` for the
  member list). Params thread from the tag's declared schemas, defaulting narrow
  (`Success = void`, `Error = never`) — this is the M2 threading WorkPool/Daemon did.
- Surface it via the `Svc` seam on `HyperlinkTag` (3rd param), exactly like
  `QueueTag` (`src/WorkPool.ts` `export type QueueTag<… > = HyperlinkTag<Self,
  QueueInstanceSpec<…>, WorkPool<…>>`).
- The generic `ServiceOf ⇄ Gate` equality can't be proven for generic
  params at the invariant Shape position, so it needs **one guarded cast** in the
  naming function (WorkPool's `nameQueueService`, `DaemonTagBuild`) —
  licensed by a `*.test-d.ts` soundness guard you add (mirror
  `test/queue-handle.test-d.ts`: bidirectional assignment + `Exact<>` hover DoDs).

### B. Effect LSP — 3 × `missingEffectContext` (lines 510, 513, 522)
All on `materializeRunTag(…)` calls inside the `build` function, whose impl
signature returns `any` (line ~508). The missing service is **`unknown`** — which
is genuinely unprovidable, NOT the benign `Exclude<R,…>` requirement-forwarding
Daemon had. So **do not blindly suppress**: this is the flavor the WorkPool engine
deliberately avoids — see the comment at `src/internal/workPool.ts:1669`
("`unknown` would assert an unprovidable service → `missingEffectContext`"), where
WorkPool chose `any` over `unknown` at its erasure boundary. Investigate whether
`materializeRunTag`/the `build` return should be `any`-erased (both-ways
assignable) rather than leaking `unknown` R. Suppress with `//
@effect-diagnostics-next-line missingEffectContext:off` ONLY if it's provably a
false-positive (as in Daemon); otherwise fix structurally.

### C. Casts — 32 (target: 1–2 guarded/documented). Playbook per cast:
Run `grep -nE "\bas\b" src/Gate.ts | grep -E "as [A-Z]|as unknown|as any|as \{"`
to enumerate. Known patterns and where to copy the fix:
- **`(config.payload ?? Schema.Void) as I` / `… as A` / `… as E`** (×3, ~L353-355)
  → the `withVoidDefault` / `withNeverDefault` **overload-narrowing** helpers.
  Copy them verbatim from `src/internal/queueTagSchemas.ts` — a public overload
  `<S extends Top>(s: S | undefined): S` + a broad impl `(s): Top => s ?? Void`.
  No cast.
- **`Object.assign(tag, stamp) as HyperlinkTag<…>` / `as GateTagSchemas`**
  (×2, ~L388, L527) → `Object.assign`'s `T & U` return already carries the added
  keys; type the stamp helper `(tag: T, …): T & Carrier` and return the
  `Object.assign` directly — no cast. See `stampQueueItemSchema` in
  `src/internal/queueTagSchemas.ts`.
- **`tag[Hyperlink.specSym].run as Hyperlink.AnyMethod`** (×2, ~L431, L576) →
  spec-introspection to recover a typed value from the runtime-flat spec. WorkPool
  **retired** this by stamping the value typed on the tag (a carrier) and reading
  it back cast-free. See `QueueItemSchemaCarrier` / `itemSchemaSym` /
  `stampQueueItemSchema` in `queueTagSchemas.ts` and its use in `buildQueueImpl`.
- **`impl as Hyperlink.WithRequirement<…>`** (~L594) and **`… run as
  ImplOf<…>["run"]`** (~L581) → the engine→contract impl boundary. In Daemon
  these were **vestigial** (removable). TEST EACH INDIVIDUALLY against the FULL
  project (see the lesson below) — remove the ones that are clean.
- **`… as Layer.Layer<any, any, any>`** (~L671) → a broad erasure; investigate
  whether the layer can be typed precisely or needs a documented boundary.
- The remaining comparison/parse casts (`(resolved.error as Schema.Top) !==
  Schema.Never`, `errorOrOptions as {…}`) → narrow with a guard or leave
  documented if they're genuine parse boundaries.

## CRITICAL lessons (learned the hard way this session)

1. **Typecheck the FULL project after touching any widely-consumed type — not
   just the file.** Running `tsc … | grep Gate.ts` will lie to you: casts
   that look vestigial in the file can be load-bearing for the *test-level* types.
   I removed casts checking only Daemon.ts and broke **190** test-level sites
   (vitest still ran green because it strips types). Always run the unfiltered
   `npx tsc --noEmit -p tsconfig.json` and diff the error count against baseline
   (which is currently **0** on integration).
2. **Test each cast removal INDIVIDUALLY.** A bulk removal is misleading — in
   Daemon, 3 of 4 "load-bearing" casts were actually individually removable; only
   1 truly was. Remove one, full-tsc, restore, repeat.
3. **`missingEffectContext` is not always a false-positive.** `Exclude<R, Tag>` =
   benign forwarding (suppress). `unknown` = a real unprovidable-service leak
   (fix structurally, à la WorkPool's `any` erasure). Gate's 3 are the `unknown`
   flavor — treat with suspicion.

## Verification bar (ALL must pass before merge)
- `npx tsc --noEmit -p tsconfig.json` → 0 non-preexisting errors (ignore only
  `scratchpad/*` and `test/resource-readiness.test.ts` TS2589).
- `npx effect-language-service diagnostics --file src/Gate.ts` → 0/0/0.
- `npx vitest run` → all green (baseline is **470 tests / 108 files** on beta.98).
- `node docs/site/scripts/treeshake-check.mjs` → Gate case green (needs
  `esbuild`; `pnpm add -D esbuild` if the gitignored lockfile dropped it).
- Cast count reduced to 1–2, each documented or test-d-guarded. No `as any`.

## Reference implementations (copy from these)
- `src/WorkPool.ts` — named handle (`WorkPool<…>` + `QueueTag` Svc seam +
  `nameQueueService` guarded cast), M2/M3 threading, `QueueErrorCarrier` /
  `QueueItemSchemaCarrier`, additive-only `buildQueueImpl`.
- `src/internal/queueTagSchemas.ts` — `withVoidDefault`/`withNeverDefault`,
  `stampQueueItemSchema` (cast-free `Object.assign` stamp), the accessor guards.
- `src/Daemon.ts` — `Daemon<R>` handle, `DaemonTagBuild` (the one guarded cast),
  `missingEffectContext` suppressions (the *forwarding* flavor), `scheduleModeOf`
  cast-free guard, `isScheduleMode`.
- `test/queue-handle.test-d.ts` — the soundness guard licensing the naming cast.

## Not in scope
The Gate **guide** (`docs/guides/run-resources.md`, currently a draft
placeholder) is for a docs agent — use `docs/guides/queues.md` as the template
(mental-model-first, `{.twoslash}` blocks, verified via
`docs/site/scripts/verify-twoslash-guides.ts` — add the page to its list).
