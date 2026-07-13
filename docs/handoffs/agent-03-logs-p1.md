# Agent 3 — Logs P1 (platform completion)

**Status:** **PLAN-FIRST** — owner 2026-07-13. Expand the unfinished half of the logs platform (Agent 2 shipped Phases 1–5 consumer break + closeout; **P1 never started**).  
**Agent:** **3** (new — Agent 2 retired).  
**Branch from:** **`integration`** (tip includes #30 Phase 5 + #33 `NodeLogs` removal + substrate retirement).  
**Working branch (after owner unlocks a slice):** `cursor/logs-p1-<slice>-a009`

**Docs bus:** [`agent-status.md`](./agent-status.md) · [`phase5-logs-migration-review.md`](./phase5-logs-migration-review.md) §P1 · [`agent-02-logs-platform-plan.md`](./agent-02-logs-platform-plan.md) · [`docs/LOGS.md`](../LOGS.md) · [`whats-changed-2026-07-13.md`](./whats-changed-2026-07-13.md)

---

## What this is (and is not)

| | |
|--|--|
| **Is** | Finish the **product-facing** half of the Agent 2 plan: level gates, how durable writes attach to store registrations, and how remote clients read per-resource logs without the old handle `logs` group. |
| **Is not** | Re-do Phase 5. `captureLogs`, handle/spec `logs`, HistoryStore `${tag.key}/logs`, `NodeLogs`, and the facet substrate are **gone**. Do not resurrect them. |
| **Is not** | Named handles / Agent D work. Stay out of handle-renaming. |
| **Is not** | `main` release / version bump. |

**Today’s working model (shipped):**

```
node runtime
  Logs.layer              → one LogRelay + one merged capture Logger
  Logs.withScope(tag)     → lineage stamps at materialize (queue/process)
  Logs.persistLayer(node) → ONE node-wide follower → LogStore (bucket = Node.key)
  Resource.logs(tag)      → { stream: unfiltered bus, query: lineageContains filter }
  Remote dashboard        → NodeStatus.logs + LogEntry.hasKey(tag.key)
```

**P1 gap in one sentence:** we can capture and store everything for a node, and filter locally — but we lack **per-channel level control**, **store-registration-native followers**, and a **first-class remote per-resource logs surface**.

---

## Three workstreams (clarify before coding)

Treat these as **separable slices**. Owner picks order and which ones to approve. Agent 3’s first deliverable is a **plan that states options + a decision checklist** — then stop.

### Workstream A — Level pipes (tag + layer)

**Intent (from Agent 2 plan):** three independent channels + umbrella.

| Combinator | Channel | What it gates |
|------------|---------|---------------|
| `Resource.logOutputLevel(level)` | Output | Merged Effect `Logger` on resource fibers (console / existing loggers) |
| `Resource.logStreamLevel(level)` | Stream | Whether a line is eligible for the **live relay** (publish path) — or only for filtered tails? **Owner decides.** |
| `Resource.logStoreLevel(level)` | Store | Whether a line is eligible for **durable append** |
| `Resource.logExportLevel(level)` | Stream + store | Shorthand for both export channels |
| `Resource.logLevel(level)` | All three | Output + stream + store |

Levels: align with Effect `LogLevel` / existing `Store.logLevel*` vocabulary (`"All" | "Debug" | "Info" | "Warn" | "Error" | "None"` — confirm exact casing vs lowercase `"all"` in old design doc; prefer **one** system, match `Store`).

**Exists today:** `Store.logLevel*` / `logLevel*Default` on **registrations** — not on Resource tags, not wired into `Logs.persistLayer` or relay publish.

**Open design choices (do not invent without owner):**

1. **Where does stream gating happen?** (a) before relay publish (line never enters bus), (b) only when building `Resource.logs` / filtered tails (bus stays full-fidelity), (c) both with independent knobs.  
2. **Layer vs tag:** plan said “layer overrides tag; levels never affect types.” Confirm.  
3. **Defaults:** export on when? (`"All"` / `"Info"` / inherit Store registration / off until `withLogExport`?)  
4. **Node-wide levels:** mirror on `Logs.persistLayer` / node registration, or resource-only first?

**Done when:** pipes exist, documented in `LOGS.md`, tests prove a Warn-only stream/store drop Info lines for that resource, types unchanged by level alone.

---

### Workstream B — Store followers + registration shape

**Intent (from Agent 2 plan):** each store registration can follow the relay and append matching lines; memo `(scopeKey, lineId)` so the same scope never double-writes.

**Exists today:**

- Single follower: `internal/logs/storeFollower.ts` → `Logs.persistLayer(node)` → appends **every** bus line into **node** `LogStore` bucket.
- `LogStore` is a standalone `Store.Service` with a built-in contract (`internal/store/logStoreSpec.ts`).
- `Store.logLevel*` on registrations is mostly unused by the logs pipeline.
- No implicit `appendLog` / `logQuery` facets on `QueueResource.store(tag)` / `Process.store(tag)` / `Resource.withStore`.

**The product question (owner must pick a write policy):**

| Option | Behavior | Fit |
|--------|----------|-----|
| **B1 — Keep node-primary (shipped direction)** | One durable writer (`persistLayer`). Resource `query` always filters the node journal by lineage. “Followers” = optional **level/filter** knobs on that one writer, not N writers. | Simplest; matches Phase 5 dashboard (`NodeStatus.logs` + filter). P1 shrinks to levels + docs + maybe memo on the one writer. |
| **B2 — Registration followers** | Each `Store.register` / toolkit `*.store(tag)` forks a follower that appends to that scope when `LogEntry.hasKey(scopeKey)` + `logStoreLevel`. Node registration optional/separate. | Matches original plan; risk of duplicate rows if both node + resource writers enabled. Needs **single-write rule** (node-primary vs resource-primary vs mutual exclusion). |
| **B3 — Hybrid** | Node writer always; resource registrations get **query-only** implicit `logQuery` that reads the node journal (no second append). | Middle ground; still no per-resource SQLite partition. |

**Also clarify:**

- Where does `lineId` / `entryId` come from? (monotonic node counter today in `persistLayer`; plan mentioned hash alternative.)
- Does `Node.logs` become a real `Store.Service` pipe (`WnbaNodeStore.pipe(Logs.registerNode(WnbaNode))`) replacing the standalone `LogStore` class, or keep `LogStore` as the node bucket API?
- Follower conformance: `test/logs-follower.test.ts` — match, memo, level gate.

**Done when:** owner-picked policy is implemented, single-write invariant tested, `LOGS.md` write-path diagram matches code.

---

### Workstream C — Remote per-resource logs

**Intent:** remote clients get a first-class way to follow/query one resource’s logs without inventing filters at every dashboard.

**Exists today:**

- Local: `Resource.logs(tag)` (and `Tag.logs` after `withLogExport`).
- Remote: **no** RPC `logs` on queue/process specs (removed Phase 5). Dashboard uses `NodeStatus.logs.stream/query` + `LogEntry.hasKey(resourceKey)` (`src/web/data.ts`).

**Options:**

| Option | Wire | Client UX |
|--------|------|-----------|
| **C1 — Keep NodeStatus + filter (document as permanent)** | No new RPC. Harden docs + helpers (`Logs.forResource(tag)` stream filter convenience). | Dashboard stays as today; less platform surface. |
| **C2 — Platform-inject on served tags** | Auto-expose `logs.stream` / `logs.query` on every served resource when log export enabled — not authored in user contracts (Phase 5 removed them from specs). | Restores remote `yield* q.logs`-ish remotely without putting `logs` back in control specs. |
| **C3 — Reserved RPC group** | e.g. under NodeStatus: `logs.byResource({ key, limit })` / dedicated stream. | One RPC home; queue/process stay clean. |

**Footgun to resolve with C (P2 from review):** `Resource.logs().stream` is **unfiltered** while `query` is lineage-scoped. Either pre-filter the handle’s `stream` with `hasKey(tag.key)`, or document + add a named helper and tests. **Do not leave ambiguous.**

**Done when:** remote path is documented, tested over HTTP (extend `host-status` / queue remote patterns), and `web/data.ts` either stays on C1 with helpers or migrates to C2/C3.

---

## Supporting cleanups (bundle with whichever slice touches the file)

- `LogQuery`: prefer `lineageContains` / `atRoot` / `atLeaf`; deprecate `processId`/`queueId` filters on `Logs.byResource` (one release shim OK).
- Child-runtime rule: document whether child processes inherit parent `LogRelay` or must `provideMerge(Logs.layer)`.
- `withLogExport` vs always-on `Resource.logs`: type-level story (`Tag.logs` absent without pipe) — keep; confirm `.test-d.ts`.

---

## Suggested slice order (recommendation for plan text — owner overrides)

1. **Decide write policy (B1/B2/B3)** and **remote policy (C1/C2/C3)** — blocks architecture.  
2. **A (levels)** — useful under any B/C choice; smaller.  
3. **B implementation** per choice.  
4. **C implementation** + stream filter footgun.  
5. Docs (`LOGS.md`) + changeset(s).

If owner wants the **smallest useful P1:** **A + C1 + pre-filter `Resource.logs` stream** — no second durable writers.

---

## Inputs (read before planning)

| Path | Why |
|------|-----|
| `docs/LOGS.md` | Shipped SSOT |
| `docs/handoffs/agent-02-logs-platform-plan.md` | Target model + open details |
| `docs/handoffs/phase5-logs-migration-review.md` §P1 | Gap table |
| `docs/handoffs/store-and-logs-design.md` | Older draft — **overrides** in Agent 2 plan win |
| `src/Logs.ts`, `src/internal/logs/{relay,storeFollower,resourceLogs,scope}.ts` | Current impl |
| `src/store/log.ts`, `src/internal/store/logStoreSpec.ts` | Durable contract |
| `src/Store.ts` (`logLevel*`) | Existing registration levels |
| `src/web/data.ts` | Remote filter pattern |
| `test/logs-resource.test.ts`, `test/logs-relay.test.ts`, `test/fixtures/logsEnv.ts` | Baseline tests |

---

## Rules

- **Plan first** — post the plan (workstream options, recommended order, owner checklist). **Stop.**  
- No code until owner unlocks a named slice (`A`, `B1`, `C2`, …).  
- Branch from **`integration`**.  
- No `as any` / `as unknown as` — fix types structurally (Agent 2 cleaned these; keep pristine).  
- Effect platform services only; match Effect-true module layout.  
- Changeset for every public API / behavior change.  
- Verify: `pnpm typecheck && pnpm test && pnpm lint`.

---

## Owner decision checklist (Agent 3’s plan must end with these)

1. Which workstreams this session? (`A` / `B` / `C` / combinations)  
2. Write policy: **B1** node-primary / **B2** registration followers / **B3** hybrid  
3. If B2: single-write rule when node + resource both enabled  
4. Stream level gate: before publish vs filter-at-tail  
5. Remote policy: **C1** / **C2** / **C3**  
6. `Resource.logs().stream`: pre-filter by `hasKey` or keep unfiltered + helpers  
7. Replace standalone `LogStore` class with `Node.logs` on `Store.Service`?  
8. Retire `byResource({ processId, queueId })` timing  
9. Ship smallest P1 (A + C1 + stream filter) vs full plan?

---

## Short prompt (paste to Agent 3)

```
Checkout integration and pull:
  git fetch origin integration && git checkout integration && git pull

Read docs/handoffs/agent-03-logs-p1.md and the Inputs table.
You are Agent 3 — Logs P1. PLAN FIRST. Named handles are owned by other agents — do not touch that work.

Deliver a plan that clarifies workstreams A (level pipes), B (store followers / write policy), and C (remote per-resource logs). Present options (B1/B2/B3, C1/C2/C3). End with the owner decision checklist — do not pick winners. Then stop.
```
