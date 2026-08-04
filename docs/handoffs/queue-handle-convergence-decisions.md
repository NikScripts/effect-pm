# Named WorkPool handle — convergence decisions

> **Naming:** read as WorkPool / Daemon / Gate / Hyperlink / hyperlink-ts (pre-rebrand names purged from this file).

**Status (2026-07-27):** historical bake + **living naming refresh**. Design still governs residuals;
**M3 shipped on tip** as named hover **`WorkPool<Payload, Success?, Error?, Requirements?>`** (not `QueueHandle` / not `QueueResource`). Residual track: [`agent-d-named-handles.md`](./agent-d-named-handles.md).

**Originally approved:** 2026-07-13 (owner: "go for best outcome"). Branch at bake: `feat/named-handles`.

### Naming note (read first)

| Bake-era name in this doc | Current tip |
|---------------------------|-------------|
| Canonical named handle `QueueHandle<…>` | **`WorkPool<Payload, Success, Error, Requirements>`** (`src/WorkPool.ts`) |
| Module / Tag `QueueResource` | **`WorkPool`** |
| Engine public alias `QueueHandle` | Still **TEMP → `EngineQueueHandle`** in `src/internal/workPool.ts` — **not** the Tag hover |
| `Resource` / `ResourceTag` | **`Hyperlink` / `HyperlinkTag`** |
| `@nikscripts/effect-pm` | **`hyperlink-ts`** |

Prose below uses **current** names. Where a milestone says “define `WorkPool`”, read **`WorkPool`**.

> Supersedes the additive-only framing in `agent-d-named-handles.md` at bake time; that file is now the
> living status board. The mechanism is not a queue-local alias — the target is **the spec as single
> source of truth** (SSOT), reached in two stages (see "SSOT design" + "Staged plan" below).

---

## The invariant (hard requirement)

**`WorkPool.Service` and `WorkPool.define` must yield the *same* handle type.**
`Tag` is **canonical** — it carries the correct, location-transparent contract shape (the one that
already crosses RPC). **`Service` conforms to `Tag`.** Enforced by a bidirectional type test that
fails the build on drift.

"Identical" = **same handle constructor, same member layout**. The two paths differ only in the
`Requirements` type-argument (see below) — that is correct, not divergence.

---

## Canonical handle

```ts
WorkPool<Payload, Error, Success, Requirements>
```

- **4 params**, all after `Payload` defaulted so trailing ones elide in hovers.
- Defaults: `Success = void`, `Error = never`, `Requirements = never`.

### Param order — LOCKED (owner, 2026-07-13)
**Mirror Effect's `<Success, Error, Requirements>` (`Effect<A, E, R>`) with `Payload` prepended.** So
`WorkPool<Payload, Success, Error, Requirements>`. Owner chose Effect-convention familiarity over
elidable-trailing-`never` optimization (my `<Payload, Error, Success, …>` rec was declined).

| pos | param | typically | default |
|----|-------|-----------|---------|
| 1 | `Payload` | always present | — |
| 2 | `Success` | usually `void` | `void` |
| 3 | `Error` | often a real `SendError` | `never` |
| 4 | `Requirements` | **transport** requirement — `never` for local `yield*`, the `Protocol` for a remote `Hyperlink.client` | `never` |

**Requirements corrected (2026-07-13):** it is **not** the worker's `R`. The worker's deps are a
**layer** concern (`.layer: Layer<Self, never, R>`) — the layer *provides* them into the service, so
they never appear on the yielded handle. Under unification (below) both `.Tag` and typed `.Service`
yield `WorkPool<…, never>` locally; `Requirements` is the transport requirement (remote clients).

| worker | hover |
|--------|-------|
| log-only | `WorkPool<EmailJob>` |
| fails, returns void, no deps | `WorkPool<EmailJob, void, SendError>` (interior `void` — accepted tradeoff) |
| returns a value, no fail | `WorkPool<EmailJob, Receipt>` |
| Service w/ deps (inferred) | `WorkPool<EmailJob, void, SendError, DbService>` |

### The dropped 5th param — `EEnqueue`
The old engine handle is `EngineQueueHandle<T, E, EEnqueue, R, A>` (TEMP public alias still named `QueueHandle`). `EEnqueue`
(`QueueItemValidationError | QueueBatchValidationError`) is **deleted**: on the canonical **Tag**
contract, enqueue validation is `orDie`'d to the contract's no-error enqueue channel (per the `layer`
docstring), so `EEnqueue` is structurally `never` on the canonical handle. `Service` conforms → it
loses `EEnqueue` too. Enqueue verbs become `(item | items) => Effect<void, never, Requirements>`.

### Requirements semantics
`Requirements` is **not** carried on the handle as "deps needed to build/run the worker" — those gate
the **layer/construction**, not handle use. On the members it is the residual requirement of *using*
the handle:
- **Tag:** `never` by construction (worker unknown at `Tag()` time — it arrives at `layer()`; over
  RPC it is erased). A remote client's transport requirement, if any, surfaces here.
- **Service:** the worker's real `R`, since `Service()(…, { effect })` bakes the worker inline.

Same constructor; the `Requirements` arg differs by construction site. A locally-run Service queue
legitimately requiring its worker deps, while a Tag/served queue does not, is the intended contract.

---

## Canonical member table

Source of truth = the **Tag** contract (`ServiceOf<QueueInstanceSpec<F>>` + universal `Hyperlink`
members). `Service` (`QueueHandleApi`, `src/internal/workPool.ts:377`) must be reshaped to match.
`R` below = the `Requirements` param (`never` on Tag).

| member | canonical (Tag) | Service today | action for Service |
|--------|-----------------|---------------|--------------------|
| `add` / `prioritize` / `defer` | `(item \| items) => Effect<void, never, R>` | `QueueEnqueue<T, EEnqueue, R>` | drop `EEnqueue` |
| `enqueue` | `(entries) => Effect<void, never, R>` | carries `EEnqueue`/`R` | drop `EEnqueue` |
| `status` | `Subscribable<QueueStatus>` | `Subscribable<QueueStatus>` | ✓ matches |
| `size` | `Subscribable<number>` | `Effect<number>` | **change** ref-shape |
| `isEmpty` | `Subscribable<boolean>` | `Effect<boolean>` | **change** ref-shape |
| `sizes` | — (folded into `status`) | `Effect<{high,normal,low}>` | **drop** |
| `completed` | — (folded into `status`) | `Effect<number>` | **drop** |
| `metrics` | `{ stream: Stream<QueueMetrics>; query: (q) => Effect<QueueMetrics[]> }` (nested — kept) | `Stream<QueueMetrics>` | **change** to nested group (add `.query`) |
| `events` | `Stream<QueueEvent<Payload, Error, Success>>` | same | ✓ matches |
| `start` / `clear` | `Effect<…, never, R>` | same | ✓ (channels) |
| `pause` / `resume` / `shutdown` | `Effect<void>` | same | ✓ matches |
| `release` | `(o?) => Effect<QueueEntry<Payload>[], never, R>` | same | ✓ matches |
| `releaseEncoded` | `(o?) => Effect<QueueEncodedEntry[], QueueReleaseEncodingError, R>` | same | ✓ matches |
| `deadLetter` / `drop` | `(selector, options) => Effect<QueueEntry<Payload>[], never, R>` | same | ✓ matches |
| `logs` | universal `Hyperlink.logs` member | **absent** | **add** |

`status` already carries per-priority sizes + `completed` + phase — that is why standalone `sizes` /
`completed` are dropped rather than duplicated (SSOT).

**Keep nesting (owner, 2026-07-13).** The nested `metrics: { stream, query }` (`WorkPool.ts:470`)
is **kept as-is** — the Tag contract's nested groups are canonical and stay. Convergence brings the
full nested shape through: **`Service` conforms UP to it** — its flat `metrics: Stream<QueueMetrics>`
becomes the nested group `{ stream, query }` (gains `.query`, backed by `HistoryStore`; empty
otherwise, as the Tag contract already is). No flattening; no spec change.

---

## Mechanism (how the name gets on the hover)

- The Tag's value type is the tag's `Service`/`Shape` = 3rd arg of `Context.ServiceClass`
  (`Hyperlink.ts:1727`, via `HyperlinkTag`). Today it is the raw mapped `ServiceOf<S, Self>` → expands.
- Point the queue tag's `Service` at the **named** `WorkPool<Payload, Success, Error, never>`, which
  is itself a named projection of `ServiceOf<QueueInstanceSpec<F>>` (see SSOT design). Named interfaces
  hover by name; members stay recoverable via prettify-ts (editor) and D3 (docs).
- **No `Hyperlink.ts` edit if avoidable** — apply the naming in a queue-specific tag return type
  (`WorkPool.ts`). If a shared seam is unavoidable, land the smallest generic, defaulted opt-in on
  `HyperlinkTag` **once**, then freeze `Hyperlink.ts` for the fan-out. (A prior handoff,
  `agent-engine-handle-display-types.md`, sketched a defaulted 3rd `Svc` param on `HyperlinkTag` — that
  is the fallback shape if a shared seam is needed.)
- **No `as` casts.** The name must be structurally identical to the shape it projects — proven by the
  invariant test, which is what makes the cast unnecessary.

---

## SSOT design (the target — highest standard)

The queue surface is currently written in **three** parallel places that must agree, plus a 4th
divergence:

1. **The spec** — `queueControlSpec` + `queueSpec` (descriptors) → generates the contract type via `ServiceOf`.
2. **The engine `QueueHandleApi`** (`internal/workPool.ts:377`) — a hand-authored interface listing the same members as `Effect`/`Stream`.
3. **The adapter `buildQueueImpl`** (`WorkPool.ts:961–1003`) — a hand-written member map from (2)→(1).
4. **`.Service` exits through (2), `.Tag` through (1)** — same queue, two shapes.

Merely routing `.Service` through the adapter (the pragmatic "B") fixes only #4 — it renames the
duplication. **SSOT removes it at the root:**

- **Spec is the one source.** `WorkPool<Payload, Success, Error, Requirements>` = the **named
  projection of `ServiceOf<QueueInstanceSpec<F>>`**. Derived, not hand-authored.
- **Delete the parallel hand-authored `QueueHandleApi`.** The engine's handle *type* becomes a
  **derivation of the spec** (the subset it natively backs), so it structurally cannot drift.
- **Adapter becomes purely *additive*, not reshaping.** The engine natively produces the contract
  member shapes it owns — `size`/`isEmpty` as `Subscribable` mapped off its `status` SubscriptionRef
  (SSOT for those already), `metrics.stream`, `events`, lifecycle. The adapter only *adds* what the
  engine legitimately doesn't own: `metrics.query` (HistoryStore), `logs`, RPC transport. One seam,
  nothing reshaped.
- **Typed `.Service` = `.Tag` + an inline-worker layer.** One construction path. `Tag ≡ Service` then
  holds **by construction**, not by a drift-catching test. `Requirements` is the only axis that
  differs (never on Tag, real on Service) — same handle, one type-arg.

**Boundary (honest):** full unification holds for **typed** queues (a payload schema drives the spec +
RPC). Untyped `.Service` (`workPoolServiceWithoutSchema`) can't join the spec path — that engine /
priority path stays separate (deferred). SSOT for typed queues; untyped is a named, separate surface.

---

## Invariant test (build-breaking)

In `test/queue-handle.test-d.ts` (type-level, cast-free), for a representative `F`:

1. `ServiceOf<QueueInstanceSpec<F>>` **⇄** `WorkPool<Decoded<Schema.Struct<F>>, A, E, never>`
   (both directions; `<Payload, Success, Error, Requirements>`) — the Tag naming is structural identity.
2. `Shape<typeof aServiceQueue>` **⇄** `Shape<typeof aTagQueue>` with `Requirements` held equal —
   the `Tag ≡ Service` invariant.
3. Consumer guard: `src/ui/data.ts` + widgets typecheck unchanged.

Any drift fails the build.

---

## Verification

- **Headless quick-info probe** (mirrors the editor, resolves to `dist/*.d.ts`):
  `paths: { "hyperlink-ts": ["dist/index.d.ts"], "hyperlink-ts/*": ["dist/*.d.ts"] }`,
  `ls.getQuickInfoAtPosition` on the `const emails = yield* Emails` binding.
  - **Baseline measured (current):** a ~20-member expanded object dump.
  - **Sibling target (bake-era):** typed `.Service` hovered as the **engine** 5-param handle
    (TEMP `QueueHandle` / `EngineQueueHandle`). Convergence target for both paths is the **contract**
    `WorkPool<EmailJob, …>` (no `EEnqueue`; Effect-order params).
  - **Verify:** trailing-default elision — that `<…, void, never>` collapses so the money case reads
    `WorkPool<EmailJob, SendError>`.
- `pnpm build` + restart TS server after every `src` change (editor reads `dist`, not `src`; beware
  stale checkout copies).
- `pnpm typecheck` 0 / `effect-language-service diagnostics` 0 / `pnpm test` green.
- Owner confirms in prettify-ts: compact name + expand-to-members.

---

## Blast radius

- `src/internal/workPool.ts` — `QueueHandleApi` / TEMP `QueueHandle` reshape (members + params); many
  internal references (`Context.Service<Id, WorkPool<…>>`, worker build, refill `load`).
- `src/WorkPool.ts` — `Tag` return type points at the named handle; `layer`/`serve` signatures.
- Untyped / schema-less `.Service` (`workPoolServiceWithoutSchema`) and `WorkPool.priority` — stay on
  the engine path (out of Phase 1 unless trivially free). There is no separate `CustomWorkPool` module
  on tip.
- Docs — `queues.md` (`.Service`), `index.md` (`.Tag`) hovers.

---

## Staged plan (approved — build in order; each milestone builds + `test` green + commit + push)

Two stages so we are never mid-air: Stage 1 is the reversible, visible convergence; Stage 2 is the
standards payoff that removes the duplication. Same destination — spec-as-SSOT.

### Finding (M1b, measured) — the divergence is 3 schema-typed members

The bidirectional harness proved **13/16 members already match** Tag ⇄ engine. The only mismatches:
`events`, `metrics` (stream element + `query` input), `release`/`releaseEncoded` (input `options`).
Root cause: the **hand-authored public types `QueueEvent` / `QueueMetrics` / `QueueReleaseOptions` do
not structurally equal their own schemas' `.Type`** — the Tag contract uses the schema `.Type`, the
engine handle uses the hand-authored interface. This is a **latent Tag/Service divergence** independent
of this work. **Decision needed:** fix those 3 public types to equal their schemas (SSOT, but blast
radius — other consumers) **vs** type the skeleton's 3 members via `Hyperlink.Decoded<typeof schema>`
locally (isolated; leaves the latent drift for a later cleanup). Recommend the SSOT fix, verified by
the same harness.

### RE-SEQUENCED (owner, 2026-07-13): unify first, then name.

Owner: "Why are we not replacing `.Service` to be built directly from `.Tag` combined with `.layer`?"
Right — unification is the SSOT foundation and it **erases** the invariant test and the 3-member
reconciliation (they only mattered while `.Service` had a separate hand-authored handle). Do it first.
`.Service` is already a tag + baked `.layer` (`WorkPoolServiceDefinition`); today its layer builds
the engine directly and types the tag as `EngineQueueHandle`. The unification just routes it through
the contract.

- **M1 (done, kept) — rename** engine `QueueHandle → EngineQueueHandle` (internal). ✓ committed.
- **M2 — unify typed `.Service` = `.Tag` + `.layer`.** Route `workPoolServiceWithSchema`'s layer
  through `WorkPool.layer` (the `buildQueueImpl` contract adapter) and type its tag as the contract
  service `ServiceOf<QueueInstanceSpec<F>>` (same as `.Tag`). Engine handle becomes internal-only.
  `.Service`'s `.layer`/`.configure`/`.wrapWorker` ergonomics preserved. Boundary: **untyped**
  `.Service` (`workPoolServiceWithoutSchema`) stays on the engine/custom path. Surface change on
  typed `.Service` (`size`→`Subscribable`, nested metrics, `logs`); update `docs/guides/queues.md`.
  After this, `.Tag ≡ .Service` **by construction** — no test needed for it.
- **M3 — name the one contract handle.** ✅ **SHIPPED (tip):** `WorkPool<Payload, Success = void, Error = never, Requirements = never>`
  on `WorkPool.Service` via `nameQueueService` + `Svc` on `HyperlinkTag`; `test/queue-handle.test-d.ts`
  proves `WorkPool.WorkPool<Decoded<F>, A, E, never> ⇄ ServiceOf<QueueInstanceSpec<F>>`. Hover:
  `yield* Emails` → `WorkPool<EmailJob>`. Gate fan-out also shipped (`Gate<>` + `nameRunService`).
  **Still open from this bake:** M2 `.Service` unify, trailing-default elision polish, prettify
  asymmetry fork, M4–M6, Daemon naming.

### M2 wrinkle (measured) — `.Service` has no wire schemas

The contract path (`materializeQueueTag` + `layer`) is schema-driven: it needs `success`/`error`
**schemas** (`Schema.Top`) to validate/encode on the wire and to type `Completed.success` /
`Failed.cause` on the `events` stream. But `WorkPool.define`'s config
(`WorkPoolConfigWithItemSchema`, `:1077`) has **only** `itemSchema` — it infers `A`/`E` from the
worker `effect`'s *types*, with no `success`/`error` schema. Confirmed by the doc at `:1080`: `A` "is
driven by the tag's `success` wire schema (default `void`)."

**RESOLVED (owner, 2026-07-13).** `.Service` is the **engine-included** path (it pulls the engine, so
it is **not browser-safe** — that's expected); `.Tag` is the **light, browser-safe** path. Therefore:

- **No-schema `.Service` must keep working** — its `Success`/`Error` are **inferred from the worker
  `effect`'s types**, never required as schemas.
- **`success`/`error` schemas are optional** on `.Service`; when supplied they **must infer to match**
  the effect's `A`/`E`.
- The handle type `WorkPool<Payload, Success, Error, Requirements>` is parameterized by the decoded
  **types**. Each path supplies them from its natural source: **schema `.Type` for `.Tag`**, **effect
  inference for `.Service`**. Runtime wire schema defaults to `Void`/`Unknown` when absent; the handle's
  `A`/`E` come from inference (correct for a local `yield*`; the wire schema only matters when *served*,
  where the caller passes schemas). Getting this cast-free (handle `A`/`E` inferred while the default
  wire schema is `Void`/`Unknown`) is the M2 implementation constraint.

**Consequence for sequencing:** M3 (define + name `WorkPool`) is the shared foundation both paths
adopt, so it comes **before** the `.Service` runtime adoption. Build `WorkPool` first, prove the
`.Tag` naming, then have `.Service` produce the same handle with `A`/`E` from inference.

### M3 authoring breakdown (measured)

The skeleton's members split three ways:
- **13 members already match** the contract using the existing hand-authored interfaces (proven by the
  scratchpad harness): `status`, `size`, `isEmpty`, `start`, `pause`, `resume`, `shutdown`, `clear`,
  `add`, `prioritize`, `defer`, `enqueue`, `deadLetter`, `drop`.
- **`metrics` + `release`/`releaseEncoded`** diverge only because `QueueMetrics` / `QueueReleaseOptions`
  don't equal their schemas' `.Type`. Item-independent (result carries `Payload`, which the skeleton
  has) → typeable via `Hyperlink.Decoded<typeof queueMetrics>` / `Decoded<typeof queueReleaseOptions>`.
- **`events`** is the crux: `Decoded<buildQueueEvent(itemSchema, successSchema, errorSchema)>` — a
  15-variant rich union (`Duration`, `Cause`, `DateTime`, optional keys). Hand-authoring a generic to
  bit-match is fragile throwaway.

**Decision (owner): fold the M6 drifted-type fix into M3 — SSOT, but RETAIN THE NARROWER TYPE.** Make
the hand-authored public types `QueueEvent<T, E, A>` / `QueueMetrics` / `QueueReleaseOptions`
**structurally equal their schemas' `.Type`** (fixing the latent drift), **converging on the *narrower*
(more precise) side — never widening a public type to match a looser schema.** Where the schema is
looser (e.g. `Schema.Cause(errorSchema, Schema.Unknown)` → `Cause<E, unknown>` vs a narrower
`Cause<E>`), **tighten the schema** so both meet at the narrow type. The handle's `Success`/`Error`
must retain the **effect-inferred `A`/`E`** (`SendError`, the real value), never the schemaless-
`.Service` default `Void`/`Unknown`.

Enforcement: (1) the bidirectional `.test-d.ts` proves `WorkPool ⇄ ServiceOf<spec>`; (2) an explicit
**no-widening guard** — each reconciled type must still be assignable *from* today's hand-authored type
(catch any accidental widening); (3) full `typecheck` + `test`. Blast radius: these are public types —
land as its own reviewed commit.

**MEASURED (drift-map probe): the drift is essentially ONE type.** Comparing each hand-authored public
type to its schema `.Type`: **`QueueEvent`, `QueueEntry`, `QueueMetrics`, `QueueReleaseOptions`,
`QueueRouteOptions`, `QueueStatus` all already MATCH.** Only **`QueueEncodedEntry`** drifts. So the
earlier harness "events/metrics/release" mismatches were my *draft's* wrong input-type guesses (e.g.
the `metrics.query` input struct), not type drift. M3 reconciliation = fix `QueueEncodedEntry`
(narrow-side) + type the handle's effectFn-input members (`metrics.query`, `release`/`deadLetter`/`drop`
inputs) against the actual decoded schema inputs rather than guesses. Small, low blast radius.

### M3 seam blocker (measured) — the prettify asymmetry, and the fork

The named `WorkPool<Payload, Success, Error, Requirements>` interface is authored and **proven
bidirectionally equal to the Tag contract** for concrete `F` (harness green). But wiring the tag's
`Service` to it **generically** fails on one member: `add`/`prioritize`/`defer` project the item
**prettified** (`Hyperlink.Decoded` = `PrettifyPayload<…>`), while `enqueue`/`release`/`deadLetter`/
`drop`/`events` carry the entry with a **raw** `item` (`queueEntry(itemSchema).Type`). `PrettifyPayload`
is deliberately **shallow** (agent-a) — it prettifies a top-level payload but not the nested
`entry.item`. So one `Payload` param can't be both prettified (for `add`) and raw (for entries)
generically. This is the documented **"nested entry `item`" payload-prettify backlog** — the contract
is internally inconsistent. It is **not** a cast wall; no `as` needed either way.

**Fork (owner):**
- **(A) Fix the entry-item prettify (clean, SSOT, deeper).** Make the entry's `item` prettified so all
  item-carrying members match `add`. Then `WorkPool<Payload>` is **symmetric** and hovers clean
  (`WorkPool<{ to: string }>`). Cost: `PrettifyPayload` is shallow by design — deepening it (even
  just for the `item` key) touches a widely-used projection; needs care + full typecheck. Fixes the
  backlog for every Hyperlink toolkit.
- **(B) Mirror the asymmetry (works now, less clean).** Export `PrettifyPayload`; author
  `add` as `QueueEnqueue<PrettifyPayload<Payload>>` and entries as `QueueEntry<Payload>`; seam passes
  the **raw** payload. Compiles generically, cast-free, verifiable immediately — but the `WorkPool`
  type is internally asymmetric and hovers as `WorkPool<{ readonly to: string }>` (raw `readonly`).

Recommend **(A)** — it matches the retain-narrower / SSOT bar and produces the clean handle; (B) trades
the member-wall wart for an asymmetry/`readonly` wart. Naming is one wiring step away once chosen.

### Stage 2 — de-duplicate the engine internals to SSOT (standards payoff; own review)

- **M4 — derive the engine handle type from the spec** (delete the hand-authored `EngineQueueHandle`
  member list; the engine-native subset is a spec projection).
- **M5 — additive adapter** — push `size`/`isEmpty` Subscribable + `metrics.stream` to be the engine's
  native shape; reduce `buildQueueImpl` to additive-only (`metrics.query`, `logs`, RPC).
- **M6 (optional) — fix the drifted public types** `QueueEvent`/`QueueMetrics`/`QueueReleaseOptions` to
  equal their schemas, retiring the quarantined drift from M3.

### M7 — fan-out template (later, per owner "every Hyperlink toolkit (Daemon, Gate, …)")

Write the reusable recipe (spec-projected named handle + `Tag ≡ Service` by construction) for Daemon,
Gate, Store, ApiMetrics — one file each, `Hyperlink.ts` frozen. Queue is the template.

---

## Open items

1. ~~Param order~~ — **LOCKED**: `<Payload, Success, Error, Requirements>` (Effect order + Payload).
2. ~~`metrics` nesting~~ — **LOCKED**: KEEP nested `metrics: { stream, query }`; Service conforms up
   (gains `.query`). No flattening, no spec change.
3. ~~Untyped `.Service` / `WorkPool.priority` engine path~~ — **LATER**, out of Phase 1.
