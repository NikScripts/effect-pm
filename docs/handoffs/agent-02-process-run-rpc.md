# Agent 2 — Process manual run RPC (`run`)

**Status:** **IMPLEMENTED** — owner locked verb **`run`** (inputless `Resource.effect`). Branch `cursor/process-run-rpc-a009`.

**Prerequisite:** Queue Phase 1a merged ([#21](https://github.com/NikScripts/effect-pm/pull/21)).

**Docs bus:** [`agent-status.md`](./agent-status.md) · [`owner-decisions.md`](./owner-decisions.md)

---

## Toolkit vocabulary (owner — do not confuse)

| Builder | Service member shape | Input |
|---------|---------------------|-------|
| **`Resource.effect`** | `Effect<Success, Error>` | **No input** — `yield* proc.run` |
| **`Resource.effectFn`** | `(Input) => Effect<Success, Error>` | **Has input** — `logs.query`, schedule `get`/`has`, … |
| **`query` / `mutate`** (`MethodKind`) | Tool metadata only (CLI/dashboard) | **Not** the same as effect vs effectFn |

**Agent failure mode:** equating `effect` = `query` and stuffing **payload** onto `Resource.effect`. Wrong.

---

## Owner decision (locked)

Replace **`runImmediately`** with spec member **`run`** built as **`Resource.effect(success, error)`** — no RPC payload.

| Rejected | Chosen |
|----------|--------|
| Session 3 deferral of RPC `error` | Per-tag RPC spec rebuild (RunResource pattern) |
| `runImmediately` — void RPC, failures store-only | **`run: Resource.effect(success, error)`** (not `effectFn`) |
| Toolkit verb name `effect` | Verb **`run`** (RunResource parity); layer `config.effect` unchanged |

**Input:** Process tag has **no `payload`**. Manual `run` is inputless. Per-invocation input = separate **`effectFn`** members.

---

## Target (shipped on branch)

```ts
buildProcessSpec({ success: S, error: E }) => ({
  ...processControlSpec,
  run: Resource.effect(success, error).annotate({
    description:
      "Run the process worker effect once, tracked — returns success; failures typed on error.",
  }),
})
```

- Engine: `recordStoreFailed` **and** fail RPC `Effect` with typed `E` when stamped.
- Observability nested groups: `stream` / `query` (was `live` / `history`).
- `Resource.effect` — no `payload`; parameterized reads on `effectFn`.

---

## Session log (2026-07-12)

**Shipped:** `buildProcessSpec`, typed `run` RPC, effect/effectFn vocabulary fix, stream/query rename, tests/docs/web/dashboard migrated, Session 3 RPC defer revoked.

**Verify:** `pnpm run typecheck && pnpm test && pnpm run lint` — green (456 tests).

**Merge:** rebase/merge onto `integration/storage` (`b693cc9`), then PR [#26](https://github.com/NikScripts/effect-pm/pull/26) → `integration/storage`.
