# Agent 2 — Queue wire Phase 1a (CQR mirror + validated cast)

**Status:** **LOCKED** — owner 2026-07-11. Supersedes PR [#19](https://github.com/NikScripts/effect-pm/pull/19) / [#20](https://github.com/NikScripts/effect-pm/pull/20) approach.  
**Base:** `integration/storage`  
**Branch:** `cursor/queue-wire-phase-1a-a009` (new — do not extend `cursor/queue-spec-wire-a009`)

**Docs bus:** [`agent-status.md`](./agent-status.md) · decisions: [`owner-decisions.md`](./owner-decisions.md)

---

## Owner decision (2026-07-11)

- **Rejected:** PR #19 generic `queueSpec<F, Success, Error>` + `as unknown as Success` inner casts.
- **Rejected:** Merge PR #20 (Process `events`) in the same pass — Process follows after Queue Phase 1a lands.
- **Chose:** **Phase 1a** — mirror **CustomQueueResource** runtime wire, single **boundary** cast, **validation** at cast site.

---

## Goal

Fix QueueResource / CustomQueueResource **inconsistency**: QR erases `events` wire to `Unknown`; CQR passes tag `success`/`error` into `buildQueueEvent`. Runtime RPC must encode/decode real values; compile-time `QueueInstanceSpec<F>` stays invariant (no `StreamElement` precision in Phase 1a).

---

## Implementation (Queue only)

### 1. `queueSpec` — wire optional, no new generics

Match `customQueueSpec` / `queueEvent`:

```ts
queueSpec(
  itemSchema,
  wire?: { readonly success?: Schema.Top; readonly error?: Schema.Top },
)
```

Use `buildQueueEvent(itemSchema, wire?.success ?? Schema.Void, wire?.error ?? Schema.Unknown)` — **no** `as unknown as Success` inside `queueSpec`.

### 2. `queueTag` — one choke-point cast

```ts
const spec = assertQueueInstanceSpec(
  queueSpec(config.payload, { success: config.success, error: config.error }),
);
```

Add `assertQueueInstanceSpec` in `src/internal/queueTagSchemas.ts` (or sibling) — **only** place that casts to `QueueInstanceSpec<F>`.

### 3. Runtime validation in `assertQueueInstanceSpec` (required)

| Check | On failure |
|-------|------------|
| `flattenSpec(spec)` keys + method kinds === baseline `flattenSpec(queueSpec(payload))` | `QueueSpecShapeError` (TaggedError) |
| Only `events` stream schema may differ from erased baseline (document invariant in TSDoc) | same |
| If `wire.success` / `wire.error` present: valid schemas; optional encode/decode smoke on minimal `Completed` / `Failed` skeleton | `QueueWireSchemaError` |

### 4. CQR alignment (same PR or immediate follow-up)

Apply the same `assert*` pattern to `customQueueSpec` → `CustomQueueInstanceSpec<F>` cast in `CustomQueueResource.ts` (today unguarded).

---

## Tests (required before merge)

| Test | Proves |
|------|--------|
| `test/queue-spec-wire.test.ts` | Tag with `success: Schema.Number` → RPC/client round-trip: `Completed.success` is `number` on wire |
| Structural | `flattenSpec(wiredSpec)` keys === `flattenSpec(erasedSpec)` keys |
| Existing `queue-success-value.test-d.ts` | Worker + store analytics typing unchanged |
| **Do not** add `StreamElement<events>` typed assertions in Phase 1a | Compile-time honesty |

`pnpm run typecheck && pnpm test && pnpm run lint`

---

## Out of scope (this PR)

- Process `events` stream (separate handoff after Phase 1a merges)
- PR #17 rebase (Session 3 consumer docs) — supervisor after architecture stable
- Store Phase 2 (tier-1 `record`/`events` erase)
- Changeset — create file; **`pnpm run version`** needs owner OK

---

## Close / do not merge

- **PR #19** `cursor/queue-spec-wire-a009` — close or replace with this branch
- **PR #20** `cursor/process-events-stream-a009` — hold

---

## Done when

- [x] Phase 1a code + validation + tests green
- [x] `owner-decisions.md` + `agent-status.md` updated on branch
- [ ] Draft PR → `integration/storage`
- [ ] Owner chat: Before/After/Verify blocks per [`supervisor-protocol.md`](./supervisor-protocol.md)

---

### Session log — 2026-07-11 (Agent 2, Phase 1a)

**Branch:** `cursor/queue-wire-phase-1a-a009` from `integration/storage` @ `0945f98`

**Shipped:**
- `queueSpec(item, wire?)` mirrors CQR — `buildQueueEvent` with tag `success`/`error` (defaults `Void`/`Unknown`), no inner casts
- `assertQueueInstanceSpec` / `assertCustomQueueInstanceSpec` in `src/internal/queueSpecAssert.ts` — structural `flattenResourceSpec` match + Completed event wire smoke; single boundary cast for CQR
- `queueTag` / `customQueueTag` call assert at build
- `test/queue-spec-wire.test.ts` — structural validation + HTTP RPC `Completed.success` round-trip
- `test/queue-http.test.ts` — stub aligned with `Resource.subscribable` after wire change
- PR **#19** / **#20** closed (superseded)

**Verify:** `pnpm run typecheck && pnpm test && pnpm run lint` — 441 tests green

---

## Short prompt (paste to Agent 2)

```
Read docs/handoffs/agent-02-queue-wire-phase-1a.md and docs/handoffs/owner-decisions.md (2026-07-11 Phase 1a).

You are Agent 2. Branch cursor/queue-wire-phase-1a-a009 from integration/storage. Do NOT extend PR #19/#20 branches.

Queue Phase 1a only: mirror CustomQueueResource wire into queueSpec; assertQueueInstanceSpec with structural + wire validation; RPC round-trip tests. No Process events. No inner as unknown as casts. No StreamElement typing claims.

Close or abandon #19/#20. Before/After/Verify each slice. Update agent-status.md on push.
```
