# QueueHandle convergence — decisions

**Status:** locked design, **approved to build** (owner: "go for best outcome"). Build from this doc; do not regenerate the API shape from memory.
**Branch:** `feat/named-handles` (from `integration`).
**Owner-approved on:** 2026-07-13.

> Supersedes the additive-only framing in `agent-d-named-handles.md`. The mechanism is not a
> queue-local alias and not a mere re-point of the duplication — the target is **the spec as single
> source of truth** (SSOT), reached in two stages (see "SSOT design" + "Staged plan" below).

---

## The invariant (hard requirement)

**`QueueResource.Tag` and `QueueResource.Service` must yield the *same* handle type.**
`Tag` is **canonical** — it carries the correct, location-transparent contract shape (the one that
already crosses RPC). **`Service` conforms to `Tag`.** Enforced by a bidirectional type test that
fails the build on drift.

"Identical" = **same handle constructor, same member layout**. The two paths differ only in the
`Requirements` type-argument (see below) — that is correct, not divergence.

---

## Canonical handle

```ts
QueueHandle<Payload, Error, Success, Requirements>
```

- **4 params**, all after `Payload` defaulted so trailing ones elide in hovers.
- Defaults: `Success = void`, `Error = never`, `Requirements = never`.

### Param order — LOCKED (owner, 2026-07-13)
**Mirror Effect's `<Success, Error, Requirements>` (`Effect<A, E, R>`) with `Payload` prepended.** So
`QueueHandle<Payload, Success, Error, Requirements>`. Owner chose Effect-convention familiarity over
elidable-trailing-`never` optimization (my `<Payload, Error, Success, …>` rec was declined).

| pos | param | typically | default |
|----|-------|-----------|---------|
| 1 | `Payload` | always present | — |
| 2 | `Success` | usually `void` | `void` |
| 3 | `Error` | often a real `SendError` | `never` |
| 4 | `Requirements` | **transport** requirement — `never` for local `yield*`, the `Protocol` for a remote `Resource.client` | `never` |

**Requirements corrected (2026-07-13):** it is **not** the worker's `R`. The worker's deps are a
**layer** concern (`.layer: Layer<Self, never, R>`) — the layer *provides* them into the service, so
they never appear on the yielded handle. Under unification (below) both `.Tag` and typed `.Service`
yield `QueueHandle<…, never>` locally; `Requirements` is the transport requirement (remote clients).

| worker | hover |
|--------|-------|
| log-only | `QueueHandle<EmailJob>` |
| fails, returns void, no deps | `QueueHandle<EmailJob, void, SendError>` (interior `void` — accepted tradeoff) |
| returns a value, no fail | `QueueHandle<EmailJob, Receipt>` |
| Service w/ deps (inferred) | `QueueHandle<EmailJob, void, SendError, DbService>` |

### The dropped 5th param — `EEnqueue`
The old engine handle is `QueueHandle<T, E, EEnqueue, R, A>`. `EEnqueue`
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

Source of truth = the **Tag** contract (`ServiceOf<QueueInstanceSpec<F>>` + universal `Resource`
members). `Service` (`QueueHandleApi`, `src/internal/queueResource.ts:377`) must be reshaped to match.
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
| `logs` | universal `Resource.logs` member | **absent** | **add** |

`status` already carries per-priority sizes + `completed` + phase — that is why standalone `sizes` /
`completed` are dropped rather than duplicated (SSOT).

**Keep nesting (owner, 2026-07-13).** The nested `metrics: { stream, query }` (`QueueResource.ts:470`)
is **kept as-is** — the Tag contract's nested groups are canonical and stay. Convergence brings the
full nested shape through: **`Service` conforms UP to it** — its flat `metrics: Stream<QueueMetrics>`
becomes the nested group `{ stream, query }` (gains `.query`, backed by `HistoryStore`; empty
otherwise, as the Tag contract already is). No flattening; no spec change.

---

## Mechanism (how the name gets on the hover)

- The Tag's value type is the tag's `Service`/`Shape` = 3rd arg of `Context.ServiceClass`
  (`Resource.ts:1727`, via `ResourceTag`). Today it is the raw mapped `ServiceOf<S, Self>` → expands.
- Point the queue tag's `Service` at the **named** `QueueHandle<Payload, Success, Error, never>`, which
  is itself a named projection of `ServiceOf<QueueInstanceSpec<F>>` (see SSOT design). Named interfaces
  hover by name; members stay recoverable via prettify-ts (editor) and D3 (docs).
- **No `Resource.ts` edit if avoidable** — apply the naming in a queue-specific tag return type
  (`QueueResource.ts`). If a shared seam is unavoidable, land the smallest generic, defaulted opt-in on
  `ResourceTag` **once**, then freeze `Resource.ts` for the fan-out. (A prior handoff,
  `agent-engine-handle-display-types.md`, sketched a defaulted 3rd `Svc` param on `ResourceTag` — that
  is the fallback shape if a shared seam is needed.)
- **No `as` casts.** The name must be structurally identical to the shape it projects — proven by the
  invariant test, which is what makes the cast unnecessary.

---

## SSOT design (the target — highest standard)

The queue surface is currently written in **three** parallel places that must agree, plus a 4th
divergence:

1. **The spec** — `queueControlSpec` + `queueSpec` (descriptors) → generates the contract type via `ServiceOf`.
2. **The engine `QueueHandleApi`** (`internal/queueResource.ts:377`) — a hand-authored interface listing the same members as `Effect`/`Stream`.
3. **The adapter `buildQueueImpl`** (`QueueResource.ts:961–1003`) — a hand-written member map from (2)→(1).
4. **`.Service` exits through (2), `.Tag` through (1)** — same queue, two shapes.

Merely routing `.Service` through the adapter (the pragmatic "B") fixes only #4 — it renames the
duplication. **SSOT removes it at the root:**

- **Spec is the one source.** `QueueHandle<Payload, Success, Error, Requirements>` = the **named
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
RPC). Untyped `.Service` (`queueResourceServiceWithoutSchema`) can't join the spec path — that is the
`CustomQueueResource` bucket (deferred). SSOT for typed queues; untyped is a named, separate surface.

---

## Invariant test (build-breaking)

In `test/queue-handle.test-d.ts` (type-level, cast-free), for a representative `F`:

1. `ServiceOf<QueueInstanceSpec<F>>` **⇄** `QueueHandle<Decoded<Schema.Struct<F>>, A, E, never>`
   (both directions; `<Payload, Success, Error, Requirements>`) — the Tag naming is structural identity.
2. `Shape<typeof aServiceQueue>` **⇄** `Shape<typeof aTagQueue>` with `Requirements` held equal —
   the `Tag ≡ Service` invariant.
3. Consumer guard: `src/web/data.ts` + widgets typecheck unchanged.

Any drift fails the build.

---

## Verification

- **Headless quick-info probe** (mirrors the editor, resolves to `dist/*.d.ts`):
  `paths: { "@nikscripts/effect-pm": ["dist/index.d.ts"], "@nikscripts/effect-pm/*": ["dist/*.d.ts"] }`,
  `ls.getQuickInfoAtPosition` on the `const emails = yield* Emails` binding.
  - **Baseline measured (current):** a ~20-member expanded object dump.
  - **Sibling target measured:** `QueueResource.Service` already hovers as
    `QueueHandle<EmailJob, SendError, never, never, void>` — the nominal handle exists; this is the
    shape both paths converge on (minus `EEnqueue`, reordered).
  - **Verify:** trailing-default elision — that `<…, void, never>` collapses so the money case reads
    `QueueHandle<EmailJob, SendError>`.
- `pnpm build` + restart TS server after every `src` change (editor reads `dist`, not `src`; beware
  stale `short-box` / `effect-pm-alt` copies).
- `pnpm typecheck` 0 / `effect-language-service diagnostics` 0 / `pnpm test` green.
- Owner confirms in prettify-ts: compact name + expand-to-members.

---

## Blast radius

- `src/internal/queueResource.ts` — `QueueHandleApi` / `QueueHandle` reshape (members + params); many
  internal references (`Context.Service<Id, QueueHandle<…>>`, worker build, refill `load`).
- `src/QueueResource.ts` — `Tag` return type points at the named handle; `layer`/`serve` signatures.
- `src/CustomQueueResource.ts` — `CustomQueueHandle` is a sibling; decide whether it converges too
  (out of Phase 1 unless trivially free).
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
radius — other consumers) **vs** type the skeleton's 3 members via `Resource.Decoded<typeof schema>`
locally (isolated; leaves the latent drift for a later cleanup). Recommend the SSOT fix, verified by
the same harness.

### RE-SEQUENCED (owner, 2026-07-13): unify first, then name.

Owner: "Why are we not replacing `.Service` to be built directly from `.Tag` combined with `.layer`?"
Right — unification is the SSOT foundation and it **erases** the invariant test and the 3-member
reconciliation (they only mattered while `.Service` had a separate hand-authored handle). Do it first.
`.Service` is already a tag + baked `.layer` (`QueueResourceServiceDefinition`); today its layer builds
the engine directly and types the tag as `EngineQueueHandle`. The unification just routes it through
the contract.

- **M1 (done, kept) — rename** engine `QueueHandle → EngineQueueHandle` (internal). ✓ committed.
- **M2 — unify typed `.Service` = `.Tag` + `.layer`.** Route `queueResourceServiceWithSchema`'s layer
  through `QueueResource.layer` (the `buildQueueImpl` contract adapter) and type its tag as the contract
  service `ServiceOf<QueueInstanceSpec<F>>` (same as `.Tag`). Engine handle becomes internal-only.
  `.Service`'s `.layer`/`.configure`/`.wrapWorker` ergonomics preserved. Boundary: **untyped**
  `.Service` (`queueResourceServiceWithoutSchema`) stays on the engine/custom path. Surface change on
  typed `.Service` (`size`→`Subscribable`, nested metrics, `logs`); update `docs/guides/queues.md`.
  After this, `.Tag ≡ .Service` **by construction** — no test needed for it.
- **M3 — name the one contract handle.** Define
  `QueueHandle<Payload, Success, Error, Requirements = never>` and point the queue tag's `Service` at
  it; bidirectional `test/queue-handle.test-d.ts` proves `QueueHandle<Decoded<F>, A, E, never> ⇄
  ServiceOf<QueueInstanceSpec<F>>`. **Type the 3 schema-typed members (`events`/`metrics`/`release`)
  via `Resource.Decoded<typeof schema>`** so the drifted hand-authored interfaces are irrelevant to the
  handle. Drop `EEnqueue`. Probe both paths → `QueueHandle<EmailJob, void, SendError>`; prettify-ts
  confirm. Green: `typecheck 0 / lint 0 / test`.

### M2 wrinkle (measured) — `.Service` has no wire schemas

The contract path (`materializeQueueTag` + `layer`) is schema-driven: it needs `success`/`error`
**schemas** (`Schema.Top`) to validate/encode on the wire and to type `Completed.success` /
`Failed.cause` on the `events` stream. But `QueueResource.Service`'s config
(`QueueResourceConfigWithItemSchema`, `:1077`) has **only** `itemSchema` — it infers `A`/`E` from the
worker `effect`'s *types*, with no `success`/`error` schema. Confirmed by the doc at `:1080`: `A` "is
driven by the tag's `success` wire schema (default `void`)."

`materializeQueueTag` defaults missing `success`→`Void`, `error`→`Unknown`. So unifying `.Service`
onto the contract **without** those schemas would degrade value-returning / typed-error queues —
e.g. the docs example's `SendError` would surface on the handle's `events` as `Unknown`, and a
non-void worker return would erase to `void`. **Decision needed (owner):**

- **(A) Add optional `success`/`error` schema fields to `.Service`'s config** — preserves `A`/`E` on
  the unified contract handle + wire; a small public API addition; default `Void`/`Unknown` when
  omitted (matches today's inferred-void behaviour for the common case).
- **(B) Default `Void`/`Unknown` always** — no API change, but typed-error / value-returning
  `.Service` queues lose that typing on the handle's `events`. Simpler, lossy.

Recommend **A** (keeps the handle honest; opt-in, non-breaking for the void case). Blocks M2.

### Stage 2 — de-duplicate the engine internals to SSOT (standards payoff; own review)

- **M4 — derive the engine handle type from the spec** (delete the hand-authored `EngineQueueHandle`
  member list; the engine-native subset is a spec projection).
- **M5 — additive adapter** — push `size`/`isEmpty` Subscribable + `metrics.stream` to be the engine's
  native shape; reduce `buildQueueImpl` to additive-only (`metrics.query`, `logs`, RPC).
- **M6 (optional) — fix the drifted public types** `QueueEvent`/`QueueMetrics`/`QueueReleaseOptions` to
  equal their schemas, retiring the quarantined drift from M3.

### M7 — fan-out template (later, per owner "every resource and process")

Write the reusable recipe (spec-projected named handle + `Tag ≡ Service` by construction) for Process,
RunResource, Store, ApiMetrics — one file each, `Resource.ts` frozen. Queue is the template.

---

## Open items

1. ~~Param order~~ — **LOCKED**: `<Payload, Success, Error, Requirements>` (Effect order + Payload).
2. ~~`metrics` nesting~~ — **LOCKED**: KEEP nested `metrics: { stream, query }`; Service conforms up
   (gains `.query`). No flattening, no spec change.
3. ~~`CustomQueueResource`~~ — **LATER**, out of Phase 1.
