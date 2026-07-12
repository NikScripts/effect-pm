# Agent 2 — Process manual run RPC (`effect`)

**Status:** **LOCKED** — owner 2026-07-11. Supersedes Session 3 “defer RPC error” docs.  
**Base:** `integration/storage`  
**Branch:** `cursor/process-run-rpc-a009` (new)

**Prerequisite:** Queue Phase 1a merged ([#21](https://github.com/NikScripts/effect-pm/pull/21)).

**Docs bus:** [`agent-status.md`](./agent-status.md) · [`owner-decisions.md`](./owner-decisions.md)

---

## Toolkit vocabulary (owner — do not confuse)

| Builder | Service member shape | Input |
|---------|---------------------|-------|
| **`Resource.effect`** | `Effect<Success, Error>` | **No input** — re-runnable effect |
| **`Resource.effectFn`** | `(Input) => Effect<Success, Error>` | **Has input** — that is what `effectFn` is for |
| **`query` / `mutate`** (`MethodKind`) | Tool metadata only (CLI/dashboard) | **Not** the same as effect vs effectFn |

**Agent failure mode:** equating `effect` = `query` and stuffing **payload** onto `Resource.effect`. Wrong.

**Codebase landmine:** `src/Resource.ts` still tags `effect` methods with internal `kind: "query"` and documents payload on `Resource.effect` in examples — **do not copy that pattern** for Process. Name builders for **service shape** (`effect` / `effectFn`), per [`agent-a-phase1-inventory.md`](./agent-a-phase1-inventory.md) C5.

---

## Owner decision (2026-07-11)

Replace **`runImmediately`** with a spec member **`effect`** built as **`Resource.effect(success, { error })`** — no RPC payload.

| Rejected | Chosen |
|----------|--------|
| Session 3 RPC `error` deferral | Per-tag spec; typed `error` (and `success`) on the wire |
| `runImmediately` / `Resource.effectFn(Schema.Void)` | **`effect: Resource.effect(...)`** — `yield* proc.effect`, not `() => Effect` |
| `Resource.effect` with `payload` | Inputless effect only; per-call input = **`effectFn`** (out of scope unless owner adds later) |
| Failures swallowed to store only | Store row **and** fail the RPC `Effect` with typed `E` |

**Member name:** **`effect`** (matches layer config `effect`). Not `run` (RunResource uses `effectFn` + payload — different shape).

---

## Problem today (`src/Process.ts`)

1. **Shared `processSpec`** — tag `success`/`error` never reach RPC ([`buildProcessTag` ~1931](src/Process.ts)).
2. **`runImmediately`** — wrong builder (`effectFn` void) + wrong impl (`Effect<void, never>`); failures only hit store ([`trackedProgram` ~659–687](src/Process.ts)).
3. **Handle API** — `runImmediately: () => Effect<…>` instead of spec-backed **`effect: Effect<…>`**.

`start` / `stop` stay `Resource.effectFn(Schema.Void)` lifecycle mutates unless owner expands.

---

## Target

### Per-tag spec

```ts
buildProcessSpec({ success: S, error: E }) => ({
  ...processControlSpec,
  effect: Resource.effect(success, { error }).annotate({
    description:
      "Run the configured worker effect once, tracked — returns success; failures typed on error.",
  }),
})
```

- **No `payload`** on this member.
- Wire in `buildProcessTag`; rebuild RPC group per tag.

### Engine

- Manual RPC `effect` runs the same tracked path as one poll/schedule tick.
- Failure → `recordStoreFailed` + **fail RPC** with typed error when stamped.
- Success → return typed success when stamped; `recordStoreCompleted` as today.
- Remove `runImmediately` everywhere (spec, impl, web, docs, examples).

### If owner later wants per-invocation input

That is a **separate** `Resource.effectFn` member (or tag `payload` + `effectFn`) — **not** payload on `Resource.effect`.

---

## Slices

1. Spec + `buildProcessTag` + remove `runImmediately`
2. Engine propagates failure on manual `effect`
3. RpcTest + `.test-d.ts` (typed error/success on `effect`)
4. `docs/legacy/`, `src/web/` rename; revoke Session 3 defer text
5. Ship + changeset file (version needs owner OK)

---

## Short prompt (paste to Agent 2)

```
Read docs/handoffs/agent-02-process-run-rpc.md and owner-decisions.md (Process run RPC + toolkit vocabulary).

You are Agent 2. Branch cursor/process-run-rpc-a009 from integration/storage.

CRITICAL: Resource.effect = Effect with NO input. Resource.effectFn = Effect WITH input. query/mutate are MethodKind for tools only — never equate effect to query or put payload on Resource.effect.

Replace runImmediately with spec member effect: Resource.effect(success, { error }) — per-tag buildProcessSpec. yield* proc.effect must fail RPC with typed error on tick failure (not store-only). No payload on this member.

Tests, docs/legacy, src/web rename. Revoke Session 3 RPC defer. Before/After/Verify each slice.
```
