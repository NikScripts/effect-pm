# Owner decisions log

**Supervisor SSOT for architecture/scope steers from owner chat.** Agents append on the same push as the work that implements the decision.

Format: see [`supervisor-protocol.md`](./supervisor-protocol.md) § Owner decisions.

---

## 2026-07-15 — Phase 3 unlock (legacy → live book + Draft)

- **Owner said:** “Go” on Phase 3 after FleetHealth landed; sync integration; ignore effect β98 fallout (Agent C).
- **Chose:** Content-side Draft convention (`status="draft"` + `{.draft}` callout; no site chrome); inventory in [`agent-01-docs-corpus-phase3-plan.md`](./agent-01-docs-corpus-phase3-plan.md); first port = fill `docs/guides/stores.md`; archive `beta-15-to-17` + `CODEBASE-INVENTORY`; keep `STORAGE.md` as agent SSOT with consumer pointer.
- **Rejected / deferred:** Batch Z deletes; STORAGE rewrite; site Draft badges; toolkit-by-example / processes ports (next batches).
- **Supervisor impact:** Branch `cursor/docs-corpus-phase3-ce05`.

## 2026-07-15 — FleetHealth landed on `integration`

- **Owner said:** Add any final improvements and sync with integration.
- **Chose:** Merge `cursor/fleet-health-ce05` (#60) onto `integration` (incl. type-shape tests, api-model regen after `api.json` → `api-model.json` rename, guide/example polish).
- **Rejected / deferred:** Phase 3 start until explicit unlock; Batch Z deletes; `layerNoop` until a concrete package ambient needs it; `docs/site` chrome.
- **Supervisor impact:** Agent 1 next = Phase 3 (owner unlock). FleetHealth guide + `@nikscripts/effect-pm/FleetHealth` are living SSOT.

## 2026-07-14 — FleetHealth (meshed stadium-board readiness)

- **Owner said:** Cost worth it if it fits Effect; then build. Fleet health product locked earlier (fleet board, not Host; auth stays README-only).
- **Chose:** `@nikscripts/effect-pm/FleetHealth` as Telemetry twin — leaf `local`, fleet `byNode` / `status`, Schema `Reachable` | `Unreachable` via `Exit.match`, `MultiNode.combineByNodeExit` keeps peer failures. Local `/health` / `withReadiness` unchanged (standards).
- **Rejected:** Folding peers inside `withReadiness`; silent omit of down peers (metric-style `fleetHealth` helper).
- **Supervisor impact:** Branch `cursor/fleet-health-ce05`; roadmap bullet marked shipped.

## 2026-07-14 — `Logs.byResource` full key; kill resource-identity `*Id`

- **Owner said:** Scope identity is **key** + **kind** (`Resource.kindOf`); get rid of `processId`/`queueId` costumes; exception only for Effect RPC naming (`groupId`); no legacy storage to keep; do it now.
- **Chose:** `Logs.byResource(tag | key)` hard-break; remove log annotation `processId`/`queueId` + helpers; CLI match via `LogEntry.hasKey`; Process/Queue event + durable-queue resource identity fields → `key`; keep `groupId`.
- **Rejected / deferred:** store memo; Agent D handles; `docs/site`; Process.events further Eng.
- **Supervisor impact:** Agent 3 Eng on `cursor/logs-byresource-full-key-a009`.

---

## 2026-07-14 — Phase 2 execute (P1–P4) + roadmap locks

- **Owner said:** Scrub living cites of anything under `docs/legacy/**`. Confirm fleet health as the health roadmap item; Resource-RPC auth = README-only (A). Agree `docs/plans/` home, archive hybrid, refresh treeshaking.
- **Chose:** Create `docs/plans/` (README + treeshaking refresh + weighted-middle + non-serializable items). Delete `docs/legacy/plans/`. Archive hybrid RuntimeStorage design. Roadmap: **fleet health** (per-node shipped; fleet aggregate open); **auth** stays a bullet with no stub file.
- **Rejected:** Host health wording; rewriting hybrid under Store; auth stub file; leaving a “see legacy” stub.
- **Supervisor impact:** Branch `cursor/docs-corpus-phase2-plan-ce05`. Phase 3 still owner-gated.

---

## 2026-07-14 — Phase 1 Batch E design-lock + Phase 2 plan unlock

- **Owner said:** “Next” after #54/#55 land — continue corpus.
- **Chose (Batch E):** Keep `*-decisions.md` + store-cutover SSOTs **flat at handoffs root** (no `decisions/` folder). Archive closed Agent 3 followers/tail plans + not-approved `store-layer-query` under `archive/2026-07/`. `queue-persistence-design` stays as historical SSOT; `queue-nonserializable-items` waits for Phase 2 move to `docs/plans/`.
- **Chose (Phase 2):** Plan-first only — [`agent-01-docs-corpus-phase2-plan.md`](./agent-01-docs-corpus-phase2-plan.md). Proposed home = **`docs/plans/`**; no mass moves until owner unlocks P1–P4.
- **Rejected / deferred:** Batch Z deletes; relocating STORAGE-cited cutover files; implementing roadmap features.
- **Supervisor impact:** Branch `cursor/docs-corpus-phase2-plan-ce05`.

---

## 2026-07-14 — Phase 1 handoffs archive batches A–D (“do it all”)

- **Owner said:** Unlock Phase 1 execution — do the archive batches (archive-first). Close what we can from open-asks in the same pass.
- **Chose:** `git mv` batches **B/C/D** → `docs/handoffs/archive/2026-07/{agents,features,reports}/`; keep `reports/README` as index; rewrite legacy/AGENTS/status ripples. Date stack **A** already closed (complete→delete); leftover beta22 handoff deleted. Type hygiene [#54](https://github.com/NikScripts/effect-pm/pull/54) landed with archive [#55](https://github.com/NikScripts/effect-pm/pull/55). Open-asks: widget seam closed (Agent C registry on `integration`); hoist docs shipped in `per-resource-dependencies` + standards; `layerNoop` stays parked until a concrete package-owned ambient needs it.
- **Rejected / deferred:** Batch **E** (`decisions/` / moving store-cutover SSOTs); batch **Z** deletes; Phases 2–3.
- **Supervisor impact:** Both PRs on `integration`. Root handoffs ≈ live bus + SSOTs + deferred edge cases only.

---

## 2026-07-14 — Process live `events` + Agent 3 ready perfection (close-out)

- **Owner said:** Ship Process live `events` (persist == stream); then Logs lineage append; then remote proof; then “go once ready perfection.”
- **Chose:** Failure surface = store union on the live stream (`Started` | `Completed` | `Failed` | `Interrupted`); PubSub-then-store publish order; remote HTTP proof (#51) over lazy-PubSub / Effect-returning `Process.make`; close superseded plan/brief PRs (#35/#46).
- **Rejected / deferred:** named handles (Agent D); `docs/site` UI; store-layer `(scopeKey, lineId)` memo; wire-level persist==stream dual-reader tests; further Process.events Eng this track.
- **Supervisor impact:** Agent 3 Eng tracks closed on `integration` (#47/#48/#51). Optional docs merge: Logs guide #50. Handoff status: [`agent-status.md`](./agent-status.md).

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
- **Supervisor impact:** Do **not** merge #19/#20. Agent 2 → [`agent-02-queue-wire-phase-1a.md`](archive/2026-07/agents/agent-02-queue-wire-phase-1a.md). #17 rebase after Queue wire settled.

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

## 2026-07-14 — Build `Resource.monitoredDependency`

- **Owner said:** Show the idea → agreed to build it; first merge with `integration` to get latest.
- **Chose:** Merge `origin/integration` into `cursor/docs-corpus-date-stack-ce05`, then add `Resource.monitoredDependency` (`status` + `changes` + `readyWhen`/`detail` readiness). Still a plain Tag shape. Delete the emptied widgets date handoff.
- **Rejected:** Pre-abstracting a new resource kind; shipping without merge.
- **Supervisor impact:** Public API + changeset on Agent 1 branch; walk next unfinished handoff after green.

---

## 2026-07-14 — Open asks priority queue

- **Owner said:** For unfinished items like the dashboard widget plug-in seam — create a new doc that lists and organizes them; **priority at the top**. Walk one issue at a time in chat.
- **Chose:** [`open-asks.md`](./open-asks.md) — owner-ordered priority queue for unfinished product/DX/consumer asks. First entry = dashboard widget plug-in seam (moved out of the date-stamped widgets handoff).
- **Rejected:** Leaving open polish forever as date-stamped one-offs; burying the walk only in docs.
- **Supervisor impact:** Agent 1 migrates unfinished asks into `open-asks.md` as they are walked; complete/declined rows leave the queue.

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
- **Chose:** Plan-first research only — [`agent-01-next-headlining-resource.md`](archive/2026-07/agents/agent-01-next-headlining-resource.md). Options: upgrade Run, productize WorkerPool, FleetStatus, Telemetry, or new work router. Owner picks direction before any implementation. **Base branch:** Agent 2’s `cursor/phase5-logs-migration-a3ad` (not bare `integration/storage`).
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
- **Chose:** [`agent-cursor-logs-store-cutover.md`](archive/2026-07/agents/agent-cursor-logs-store-cutover.md) on `cursor/logs-store-cutover-a009`.
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
- **Toolkit rule (owner):** `Resource.effect` → `Effect<S,E>` no args; `Resource.effectFn` → `(In) => Effect<S,E>`; `query`/`mutate` = `MethodKind` for tools only — see [`agent-a-phase1-inventory.md`](archive/2026-07/agents/agent-a-phase1-inventory.md) C5.
- **Chose (withdrawn):** [`agent-02-process-run-rpc.md`](archive/2026-07/agents/agent-02-process-run-rpc.md) — member name **`effect`**, not `run` (RunResource `run` is `effectFn`+payload).
