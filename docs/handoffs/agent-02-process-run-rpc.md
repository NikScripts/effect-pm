# Agent 2 — Process manual run RPC (`run`)

**Status:** **IMPLEMENTED** — owner Slice 0 locked (`run`, void payload). Branch `cursor/process-run-rpc-a009`.

**Prerequisite:** Queue Phase 1a merged ([#21](https://github.com/NikScripts/effect-pm/pull/21)).

**Docs bus:** [`agent-status.md`](./agent-status.md) · [`owner-decisions.md`](./owner-decisions.md)

---

## Owner decision (2026-07-11)

Remote Process clients must get **typed `error`** (and **`success`** when stamped) on the **manual run** RPC — not store-only, not a background-only failure.

| Rejected | Chosen |
|----------|--------|
| Session 3 deferral of RPC `error` | Per-tag RPC spec rebuild (RunResource pattern) |
| `runImmediately` — void RPC, `Effect<void, never>`, failures swallowed to store | Replace with **`run`** — proper **`Resource.effect`** on `processSpec` (not `effectFn`) |
| Internal `() => Effect.…` handle API | Engine **`Process.make`** handle only — toolkit uses **`yield* Tag.run`** (Effect property) |

**Naming (Slice 0 locked):** verb **`run`** (parity with `RunResource.run`). Layer `config.effect` and supervisor `process.effect` stay as-is — different concepts.

**Input (Slice 0 locked):** Process has **no tag `payload`**. Manual `run` is inputless `Resource.effect(success, error)` — worker stays nullary in layer config. Members that take per-invocation input (`logs.query`, schedule `get`/`has`, …) use **`Resource.effectFn`**.

---

## Problem today (`src/Process.ts`)

1. **Shared `processSpec`** — all tags use one constant; tag `success`/`error` stamps never reach RPC ([`buildProcessTag` ~1931](src/Process.ts)).
2. **`runImmediately`** — `Resource.effectFn(Schema.Void)` today; impl `Effect<void, never>`; [`trackedProgram` ~659–687](src/Process.ts) records `Failed` to store and **returns** without failing RPC. **Owner:** manual run must be **`Resource.effect`**, not `effectFn`.
3. **Handle shape** — engine exposes `runImmediately: () => Effect<…>` instead of a spec-backed RPC method.

`start` / `stop` stay void lifecycle commands unless owner expands scope (fork/interrupt errors only).

---

## Target (RunResource-aligned)

### Per-tag spec factory

```ts
// internal — mirror runSpec in internal/runResourceSchema.ts
buildProcessSpec({
  success: S,
  error: E,
}) => ({
  ...processControlSpec,       // status, logs, start, stop, …
  // Member name: `run` — built with Resource.effect, not effectFn
  run: Resource.effect(success, error).annotate({
    description: "Run the process worker effect once, tracked — returns success; failures typed on error.",
  }),
})
```

Wire in `buildProcessTag` instead of bare `processSpec`. Rebuild RPC group per tag (same as `RunResource` `runSpec`).

### Engine

- One tracked execution path for: schedule tick, poll tick, **and manual RPC `run`**.
- On worker failure: **`recordStoreFailed`** (keep) **and** fail the RPC `Effect` with typed `E` when `errorOf(tag)` set.
- On success: return `success` on RPC when stamped; `recordStoreCompleted` as today.
- **Remove** `runImmediately` from public spec, impl, docs, `src/web/`, examples. Migration: `runImmediately` → `run`.

### Process tag wire

Process tag is `{ success?, error? }` only — **no `payload`**. The worker program lives in layer `config.effect` (nullary `Effect<A, E, R>`).

---

## Slices

### 1 — Spec + tag build

- `buildProcessSpec` / per-tag spec in `Process.ts`
- `buildProcessTag` uses stamped `success`/`error`/`payload`
- Deprecate/remove `runImmediately` from `processSpec`

### 2 — Engine + impl

- Propagate failure to RPC on manual `run`
- Unify tracked run entry (schedule / poll / RPC)
- `buildProcessImpl` wires `run` handler

### 3 — Tests

- `test/process-run-rpc.test.ts` — RpcTest round-trip: typed error + success
- `.test-d.ts` — client `ServiceOf` shows `run` error/success channels
- Store rows still written on failure (existing sqlite tests stay green)

### 4 — Docs + dashboard

- `docs/legacy/PROCESS-API.md`, `docs/legacy/guides/process.md` — **revoke defer**; document `run`
- `src/web/data.ts`, `widgets.tsx` — rename `runImmediately` → `run`
- Changeset (create; version needs owner OK)

### 5 — Ship

- `agent-status.md`, agent report Session 4b
- Draft PR → `integration/storage`
- Before/After/Verify per [`supervisor-protocol.md`](./supervisor-protocol.md)

---

## Out of scope

- Live `events` stream (#20) — separate unless owner folds in
- `start`/`stop` typed error (unless owner adds in Slice 0)
- Store Phase 2 tier-1 typing

---

## Short prompt (paste to Agent 2)

```
Read docs/handoffs/agent-02-process-run-rpc.md and owner-decisions.md (2026-07-11 Process run RPC).

You are Agent 2. Branch cursor/process-run-rpc-a009 from integration/storage.

Slice 0 locked: verb **`run`**; no tag `payload` (worker nullary).

Then implement per handoff: per-tag buildProcessSpec, replace runImmediately with `run` using **Resource.effect** (not effectFn), typed error/success on RPC, engine propagates failure, tests, docs, web. Revoke Session 3 RPC defer text.

Before/After/Verify each slice. Update owner-decisions.md on same push as code.
```

---

## Session log (2026-07-12)

**Slice 0 (owner):** verb **`run`**; no tag `payload` — wire via `Resource.effect` (inputless); `effectFn` for members with input.

**Shipped:**
- `buildProcessSpec` / `ProcessInstanceSpec` — `run: Resource.effect(success, error)` (no payload)
- `logs.query`, schedule `get`/`has` migrated from payload-on-`Resource.effect` to `Resource.effectFn`
- Queue/CQR/nodeStatus `metrics.query` / `logs.query` migrated to `Resource.effectFn`
- `Resource.effect` API — **no `payload`** (inputless only); parameterized reads use `effectFn`
- Engine propagates typed failures; toolkit `yield* proc.run` (not `proc.run()`); engine handle keeps `proc.run()`
- Tests/docs/web/dashboard use `run`; Session 3 RPC defer revoked

**Verify:** `pnpm run typecheck && pnpm test` — green (455 tests).
