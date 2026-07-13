# QueueHandle convergence — decisions

**Status:** locked design, pre-implementation. Build from this doc; do not regenerate the API shape from memory.
**Branch:** `feat/named-handles` (from `integration`).
**Owner-approved on:** 2026-07-13.

> Supersedes the additive-only framing in `agent-d-named-handles.md`. The named-handle goal stands;
> the mechanism is now **convergence** (one canonical handle both paths yield), not a queue-local alias.

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
| 4 | `Requirements` | `never` on Tag always; real only on a dep-carrying Service | `never` |

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
- Point the queue tag's `Service` at the **named** `QueueHandle<Payload, Error, Success, never>`.
  Empty-`extends`/named interfaces hover by name; the members stay recoverable via prettify-ts (editor)
  and D3 (docs).
- **No `Resource.ts` edit if avoidable** — apply the naming in a queue-specific tag return type
  (`QueueResource.ts`). If a shared seam is unavoidable, land the smallest generic, defaulted opt-in on
  `ResourceTag` **once**, then freeze `Resource.ts` for the fan-out. (A prior handoff,
  `agent-engine-handle-display-types.md`, sketched a defaulted 3rd `Svc` param on `ResourceTag` — that
  is the fallback shape if a shared seam is needed.)
- **No `as` casts.** The name must be structurally identical to the shape it aliases — proven by the
  invariant test, which is what makes the cast unnecessary.

---

## Invariant test (build-breaking)

In `test/queue-handle.test-d.ts` (type-level, cast-free), for a representative `F`:

1. `ServiceOf<QueueInstanceSpec<F>>` **⇄** `QueueHandle<Decoded<Schema.Struct<F>>, E, A, never>`
   (both directions) — the Tag naming is structural identity.
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

## Phasing

- **P1 — queue (this branch, serial):** reshape the canonical `QueueHandle`; conform `Service`; name
  the `Tag` handle; land any shared `Resource.ts` seam **once**; invariant test; probe; template.
- **P2 — fan-out (later, per owner "every resource and process"):** apply the same canonical-handle +
  `Tag ≡ Service` pattern to Process, RunResource, Store, ApiMetrics — one file each, `Resource.ts`
  frozen. The queue is the reusable template.

---

## Open items

1. ~~Param order~~ — **LOCKED**: `<Payload, Success, Error, Requirements>` (Effect order + Payload).
2. ~~`metrics` nesting~~ — **LOCKED**: KEEP nested `metrics: { stream, query }`; Service conforms up
   (gains `.query`). No flattening, no spec change.
3. ~~`CustomQueueResource`~~ — **LATER**, out of Phase 1.
