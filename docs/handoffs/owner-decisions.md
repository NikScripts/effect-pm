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

## 2026-07-11 — Process manual run RPC (owner)

- **Owner said:** Remote Process RPC must use tag **`error`** / **`success`** on the manual run path. Replace **`runImmediately`** with spec member **`effect`** = **`Resource.effect(success, { error })`** — **no input** (`Effect`, not `effectFn`). Failures must fail the RPC, not store-only.
- **Rejected:** Equating **`effect`** with **`query`**; putting **payload** on `Resource.effect` (input → **`effectFn`** only). Session 3 RPC defer. `runImmediately` as void `effectFn`.
- **Toolkit rule (owner):** `Resource.effect` → `Effect<S,E>` no args; `Resource.effectFn` → `(In) => Effect<S,E>`; `query`/`mutate` = `MethodKind` for tools only — see [`agent-a-phase1-inventory.md`](./agent-a-phase1-inventory.md) C5.
- **Chose:** [`agent-02-process-run-rpc.md`](./agent-02-process-run-rpc.md) — member name **`effect`**, not `run` (RunResource `run` is `effectFn`+payload).
