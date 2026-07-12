# Agent 2 — Process manual run RPC (`run` / `effect`)

**Status:** **IMPLEMENTED** — owner Slice 0 locked (`run`, void payload). Branch `cursor/process-run-rpc-a009`.

**Prerequisite:** Queue Phase 1a merged ([#21](https://github.com/NikScripts/effect-pm/pull/21)).

**Docs bus:** [`agent-status.md`](./agent-status.md) · [`owner-decisions.md`](./owner-decisions.md)

---

## Owner decision (2026-07-11)

Remote Process clients must get **typed `error`** (and **`success`** when stamped) on the **manual run** RPC — not store-only, not a background-only failure.

| Rejected | Chosen |
|----------|--------|
| Session 3 deferral of RPC `error` | Per-tag RPC spec rebuild (RunResource pattern) |
| `runImmediately` — void RPC, `Effect<void, never>`, failures swallowed to store | Replace with **`run`** or **`effect`** — proper **`Resource.effect`** on `processSpec` (not `effectFn`) |
| Internal `() => Effect.…` handle API | Toolkit **service member** — `yield* Tag.run(…)` / `yield* Tag.effect(…)` |

**Naming (confirm with owner in Slice 0 — one message):** default recommendation **`run`** (parity with `RunResource.run`); **`effect`** if owner wants the verb to match layer config `effect`.

**Input (owner 2026-07-11):** Manual run is **not** a zero-argument fire-and-forget. RPC must accept **payload when the tag defines one** (mirror RunResource). If tag has no payload slot, use **`Schema.Void`** payload — but the wire shape is still **`Resource.effect(success, { payload, error })`** (`query` kind, lazy re-runnable — **not** `effectFn` / `mutate`).

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
  payload: Schema.Void | P,   // from tag when stamped
  success: S,
  error: E,
}) => ({
  ...processControlSpec,       // status, logs, start, stop, …
  // Member name: `run` or `effect` (owner Slice 0) — built with Resource.effect, not effectFn
  run: Resource.effect(success, { payload, error }).annotate({
    description: "Run the process worker effect once, tracked — returns success; failures typed on error.",
  }),
})
```

Wire in `buildProcessTag` instead of bare `processSpec`. Rebuild RPC group per tag (same as `RunResource` `runSpec`).

### Engine

- One tracked execution path for: schedule tick, poll tick, **and manual RPC `run`**.
- On worker failure: **`recordStoreFailed`** (keep) **and** fail the RPC `Effect` with typed `E` when `errorOf(tag)` set.
- On success: return `success` on RPC when stamped; `recordStoreCompleted` as today.
- **Remove** `runImmediately` from public spec, impl, docs, `src/web/`, examples. Migration: `runImmediately` → `run` (or `effect`).

### Process tag wire (if payload required)

Today Process tag is `{ success?, error? }` only. If manual run needs caller input:

- Add optional **`payload`** on `ProcessTagOptions` (config-object + positional overloads — follow PR #25 toolkit pattern).
- Layer `config.effect` becomes `(payload) => Effect<A, E, R>` when payload stamped, else nullary `Effect<A, E, R>`.

**Slice 0:** Ask owner: payload schema on tag vs always-void manual run with only success/error typing.

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

- `docs/legacy/PROCESS-API.md`, `docs/legacy/guides/process.md` — **revoke defer**; document `run`/`effect`
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

Slice 0: ask owner — verb `run` vs `effect`; whether Process tag gets optional `payload` for manual RPC input.

Then implement per handoff: per-tag buildProcessSpec, replace runImmediately with run/effect using **Resource.effect** (not effectFn), typed error/success on RPC, engine propagates failure, tests, docs, web rename. Revoke Session 3 RPC defer text.

Before/After/Verify each slice. Update owner-decisions.md on same push as code.
```

---

## Session log (2026-07-12)

**Slice 0 (owner):** verb **`effect`** (2026-07-12 override); no tag `payload` — `Resource.effect` inputless; `effectFn` for members with input.

**Shipped:**
- `buildProcessSpec` / `ProcessInstanceSpec` — `effect: Resource.effect(success, { error })` (no payload)
- `logs.history`, schedule `get`/`has` migrated from payload-on-`Resource.effect` to `Resource.effectFn`
- Engine propagates typed failures; `yield* proc.effect` (not `proc.run()`)
- Tests/docs/web/dashboard use `effect`; Session 3 RPC defer revoked

**Verify:** `pnpm run typecheck && pnpm test` — green (455 tests).
