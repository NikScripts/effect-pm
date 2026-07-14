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

## 2026-07-14 — Logs store followers: Agent 3 must repeat back (correction)

- **Owner said:** Agent 2’s job included stores **following** the log bus and persisting via
  registration-native followers. Leaving only `Logs.persistLayer` → standalone `LogStore` left
  Agent 3 clueless. Put a handoff on `integration` that states the locked intent and **requires
  Agent 3 to repeat it back** before code.
- **Chose:** Rewrite [`agent-03-logs-p1.md`](./agent-03-logs-p1.md) — supersede the “B1/B2/B3 menu”
  brief. End state = registration followers (`appendLog` / `logQuery` / shared follower factory);
  current `LogStore`+`persistLayer` is interim. Agent 3 first reply = repeat-back only.
- **Rejected:** Treating node-primary-only as the approved permanent design without an explicit
  unlock; Agent 3 coding before restating the model.
- **Supervisor impact:** Agent 3 blocked on owner accepting the repeat-back.

---

## 2026-07-14 — Date-stamped handoffs: complete → delete

- **Owner said:** One stack at a time. If a doc is **implemented / complete → delete**; if not finished → **defer to owner**. Do the first stack, then bring back whatever was never finished.
- **Chose:** First stack = `docs/handoffs/2026-*.md`. Delete completed ones in-place (no archive for this batch). Leave unfinished four for owner call. Update inbound links in the same change.
- **Rejected:** Archive-first for this stack; continuing to next stacks before owner answers the deferred list.
- **Supervisor impact:** Agent 1 executes deletes on `cursor/docs-corpus-date-stack-ce05`; waits on deferred docs before next stack.

---

## 2026-07-14 — Agent 1 Phase 1 handoffs: thorough / archive-first / defer to owner

- **Owner said:** Yes (to the Phase 1 plan) — be **thorough and precautionary**, and **defer to** the owner on calls.
- **Chose:** Phase 1 execution posture:
  1. **Archive over delete** by default; **no deletes** unless owner ticks specific rows.
  2. **No ambiguous moves** without owner OK (SSOT docs, anything linked from `AGENTS.md` / legacy STORAGE/guides / `docs/site/README`, open agent briefs, Agent 3 plans, `store-layer-query`, `decisions/` layout).
  3. Live bus + historical SSOT stay at `handoffs/` root until owner unlocks a move.
  4. Execution only in **owner-approved batches** (Agent 1 proposes; owner green-lights).
- **Rejected:** Aggressive deletes; freelancing `decisions/` subdirectory or bulk root reshuffles; touching `docs/site` UI.
- **Supervisor impact:** Agent 1 updates plan locking these rules; waits for batch unlock before `git mv`.

---

## 2026-07-14 — Agent 1 → docs corpus (UI stays with lettered agents)

- **Owner said:** Save UI / Tailscale-facing site work for lettered (local) agents. Give Agent 1 the docs corpus instead: **handoffs cleanup first**, then plans refactor/migration, then port legacy docs with a **Draft** page label (owner will refine Draft UX after assign).
- **Chose:** [`agent-01-docs-corpus.md`](./agent-01-docs-corpus.md) — Phase 1 plan-first inventory of `docs/handoffs/`. No `docs/site` UI. Draft label = content-side proposal only until B/owner specify site chrome.
- **Rejected:** Agent 1 on dashboard/web/Tailscale UX; starting legacy port before handoffs/plans hygiene.
- **Supervisor impact:** Agent 1 docs track; lettered agents keep site/UI.

---

## 2026-07-14 — Logs P1 → Agent 3 (Agent 2 retired)

- **Owner said:** Handles are owned by other agents for now. Focus next engine work on **Logs P1** (former “option 2”): level pipes / store followers / remote per-resource logs. Expand and clarify that brief for a **new Agent 3**.
- **Chose:** [`agent-03-logs-p1.md`](./agent-03-logs-p1.md) — **superseded by the correction entry above** (registration followers are the locked write model; repeat-back first).
- **Rejected:** Assigning named-handles work to Agent 3; treating Logs as closed without an explicit P1 park/unlock.
- **Supervisor impact:** Agent 2 retired after #33; Agent 3 owns Logs P1.

---

## 2026-07-13 — Next headlining resource research (Agent 1)

- **Owner said:** Agent 1 is free. Process + QueueResource are the top two; RunResource is lackluster as a product headline. Explore leaning into **fleet / peer** features — ideally first resource with mesh from day one.
- **Chose:** Plan-first research only — [`agent-01-next-headlining-resource.md`](./agent-01-next-headlining-resource.md). Options: upgrade Run, productize WorkerPool, FleetStatus, Telemetry, or new work router. Owner picks direction before any implementation. **Base branch:** Agent 2’s `cursor/phase5-logs-migration-a3ad` (not bare `integration/storage`).
- **Rejected:** Immediate RunResource polish without research; treating Run store cutover as “headlining done.”
- **Supervisor impact:** Agent 1 research session on Agent 2 tip; Agent 2 continues Logs PR #30.

---

## 2026-07-12 — Integration fold complete (`integration/storage` @ `4c543c8`)

- **Owner said:** Integration line is consolidated — merge docs group (A corpus, B intro, C manifest), Process run RPC (#26), queue ref fixes (#23–#25).
- **Chose:** `integration/storage` is the single go-forward branch; **`run`** verb locked for Process manual RPC; effect/effectFn vocabulary shipped.
- **Rejected:** Further integration branch sprawl; `integration/web-ui-refresh` (brief retracted).
- **Supervisor impact:** Next = Cursor Logs cutover; **`main` release deferred** until Logs lands.

---

## 2026-07-12 — Logs before release (owner)

- **Owner said:** Wait on `main` merge / version bump. Finish **Logs** store migration first. Use **Cursor** (3 Claude agents busy).
- **Chose:** [`agent-cursor-logs-store-cutover.md`](./agent-cursor-logs-store-cutover.md) on `cursor/logs-store-cutover-a009`.
- **Rejected:** `main` release before Logs; full platform-logs redesign in the same session.
- **Supervisor impact:** Agent 3 (Cursor) active.

---

## 2026-07-12 — Process manual run RPC vocabulary (owner correction)

- **Owner said:** Toolkit member stays **`run`**. `Resource.effect` is **inputless** (`yield* proc.run`); `Resource.effectFn` takes per-invocation input (`logs.query`, schedule `get`/`has`, …). No `payload` on `Resource.effect`.
- **Chose:** `run: Resource.effect(success, error)` with **no payload**; migrate all payload members to `effectFn`; remove `payload` from `Resource.effect` API.
- **Rejected:** `payload` on `Resource.effect`; renaming toolkit verb to `effect`; `yield* proc.run()` on stamped tags.
- **Supersedes:** conflicting 2026-07-11 entry below that chose `effect` as verb name.

---

## 2026-07-11 — Process manual run RPC (owner Slice 0 locked)

- **Owner said:** Remote Process clients need typed `error` (and `success` when stamped) on manual run — not store-only.
- **Chose:** Verb **`run`** (RunResource parity); **no `payload`** on Process tag — worker stays nullary; manual RPC via inputless `Resource.effect(success, error)` (not `effectFn`). Per-tag `buildProcessSpec`; engine propagates failure on manual `run` RPC while still writing store rows.
- **Rejected:** `effect` verb name; optional tag `payload`; Session 3 RPC defer language; `runImmediately` void RPC.
- **Supervisor impact:** Branch `cursor/process-run-rpc-a009`; revoke defer text in legacy PROCESS-API / STORAGE docs.

---

## 2026-07-11 — Process manual run RPC vocabulary (superseded)

*Superseded by 2026-07-12 entries — verb is **`run`**, not `effect`.*

- **Owner said:** Remote Process RPC must use tag **`error`** / **`success`** on the manual run path. Replace **`runImmediately`** with spec member **`effect`** = **`Resource.effect(success, { error })`** — **no input** (`Effect`, not `effectFn`). Failures must fail the RPC, not store-only.
- **Rejected:** Equating **`effect`** with **`query`**; putting **payload** on `Resource.effect` (input → **`effectFn`** only). Session 3 RPC defer. `runImmediately` as void `effectFn`.
- **Toolkit rule (owner):** `Resource.effect` → `Effect<S,E>` no args; `Resource.effectFn` → `(In) => Effect<S,E>`; `query`/`mutate` = `MethodKind` for tools only — see [`agent-a-phase1-inventory.md`](./agent-a-phase1-inventory.md) C5.
- **Chose (withdrawn):** [`agent-02-process-run-rpc.md`](./agent-02-process-run-rpc.md) — member name **`effect`**, not `run` (RunResource `run` is `effectFn`+payload).
