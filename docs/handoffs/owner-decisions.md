# Owner decisions log

**Supervisor SSOT for architecture/scope steers from owner chat.** Agents append on the same push as the work that implements the decision.

Format: see [`supervisor-protocol.md`](./supervisor-protocol.md) § Owner decisions.

---

## 2026-07-11 — Queue wire erase + Process live `events` (retroactive — from PR #19/#20 handoff)

*Logged by supervisor from Agent 2 session-4 handoff + owner relay. Agent should have written this before PRs opened.*

- **Owner said:** Fix Queue `events` stream typing (agent was copying Queue pattern for Process); align Process failure visibility with Queue's live stream model.
- **Chose (initial):** Phase 1 — type the **RPC wire** (`queueSpec` / `buildProcessSpec` pass tag `success`/`error`); add Process **`events`** PubSub stream; failures on **`events` + store**, not void lifecycle RPC `error`.
- **Rejected:** Per-tag `processSpec` rebuild for `start`/`stop`/`runImmediately` RPC error channel (Session 2 stretch).
- **Supervisor impact (initial):** Merge **#19 → #20** — **withdrawn** see below.

---

## 2026-07-11 — Queue Phase 1a middle ground (owner + supervisor)

- **Owner said:** PR #19 approach **not OK** — seek safe middle ground; add validation to make boundary cast defensible.
- **Chose:** **Phase 1a** — mirror **CustomQueueResource**: `queueSpec(payload, { success?, error? })`, runtime-correct `buildQueueEvent`, single **`assertQueueInstanceSpec`** boundary cast (not inner `as unknown as Success`). **Validation:** structural `flattenSpec` key/kind match + wire schema smoke; contract RPC round-trip test.
- **Rejected:** PR **#19** (generic `queueSpec` + inner casts), PR **#20** merge until Phase 1a lands; claiming `StreamElement<events>` typing in Phase 1a.
- **Deferred:** Process live `events` — separate session after Queue Phase 1a; owner still picks failure surface (`events` vs store-only vs RPC rebuild).
- **Supervisor impact:** Do **not** merge #19/#20. Agent 2 → [`agent-02-queue-wire-phase-1a.md`](./agent-02-queue-wire-phase-1a.md). #17 rebase after Queue wire settled.

---

## 2026-07-12 — Process manual effect RPC (owner vocabulary override)

- **Owner said:** `Resource.effect` = inputless `Effect<S,E>` (`yield* proc.effect`); `Resource.effectFn` = `(In) => Effect<S,E>` for members with input (`logs.history`, schedule `get`/`has`, `start`/`stop`, schedule mutations). `query`/`mutate` are MethodKind for tools only — not equivalent to effect vs effectFn.
- **Chose:** Manual run verb **`effect`** (not `run`); `buildProcessSpec` wires `effect: Resource.effect(success, { error })` with **no payload**; failures fail RPC `Effect` with typed `E` when stamped; migrate payload-on-`Resource.effect` in Process spec (`logs.history`, schedule `get`/`has`) to `effectFn`.
- **Rejected:** Putting payload on `Resource.effect` for Process; equating `effect`↔query or `effectFn`↔mutation in API docs.
- **Supervisor impact:** Branch `cursor/process-run-rpc-a009`; revoke Session 3 RPC defer text; tests/docs/web use `yield* proc.effect`.

---

## 2026-07-11 — Process manual run RPC (owner Slice 0 locked — superseded by 2026-07-12)

- **Owner said:** Remote Process clients need typed `error` (and `success` when stamped) on manual run — not store-only.
- **Chose:** Verb **`run`** (RunResource parity); **no `payload`** on Process tag — worker stays nullary; RPC wire uses `Schema.Void` payload via `Resource.effect` (not `effectFn`). Per-tag `buildProcessSpec`; engine propagates failure on manual `run` RPC while still writing store rows.
- **Rejected:** `effect` verb name; optional tag `payload`; Session 3 RPC defer language; `runImmediately` void RPC.
- **Supervisor impact:** Branch `cursor/process-run-rpc-a009`; revoke defer text in legacy PROCESS-API / STORAGE docs.

---

## 2026-07-11 — Process manual run RPC (owner)

- **Owner said:** Remote Process RPC must use tag **`error`** schema (not store-only). Replace **`runImmediately`** with **`run`** or **`effect`** — built with **`Resource.effect`** (query kind), **not** `Resource.effectFn`. Failures must return typed errors on the wire. Manual run should support **payload** when the tag defines one.
- **Rejected:** Session 3 documentation that “defers” RPC `error` indefinitely; `runImmediately` as `Effect<void, never>` with failures only in store; PR #20 `events` stream as substitute for typed RPC failure.
- **Chose:** New workstream [`agent-02-process-run-rpc.md`](./agent-02-process-run-rpc.md) — per-tag `buildProcessSpec`, propagate failures on manual run RPC, remove `runImmediately`.
- **Open (Agent 2 Slice 0):** Verb **`run`** vs **`effect`**; whether Process tag gains optional **`payload`** slot.
- **Supervisor impact:** Do not treat #17 defer language as policy; Agent 2 branch `cursor/process-run-rpc-a009` after owner confirms naming/payload.
