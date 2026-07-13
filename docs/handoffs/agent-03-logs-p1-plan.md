# Agent 3 — Logs P1 plan (options only)

**Status:** plan posted — awaiting owner decisions. **No implementation** until a named slice is unlocked (`A`, `B1`, `C2`, …).  
**Branch:** `cursor/logs-p1-plan-906e` (from `integration`).  
**Brief:** [`agent-03-logs-p1.md`](./agent-03-logs-p1.md).  
**Out of scope:** named handles / Agent D; Phase 5 resurrection; `main` release / version bump.

---

## Baseline (shipped — do not reopen)

```
Logs.layer              → one LogRelay + one merged capture Logger
Logs.withScope(tag)     → lineage stamps at materialize
Logs.persistLayer(node) → ONE node-wide follower → LogStore (bucket = Node.key)
Resource.logs(tag)      → { stream: unfiltered bus, query: lineageContains }
Remote dashboard        → NodeStatus.logs + LogEntry.hasKey(tag.key)
```

| Exists | Gap |
|--------|-----|
| `Store.logLevel*` / `logLevel*Default` on registrations (`"All"\|"Debug"\|…\|"None"`) | Not wired into relay publish or `persistLayer` |
| Node-wide `storeFollower` (appends every bus line) | No per-registration followers; no memo; no level gate |
| Standalone `LogStore` + `Logs.persistLayer` | No `Node.logs` / `Logs.registerNode` on `Store.Service` |
| Local `Resource.logs` / `withLogExport` | No first-class remote per-resource surface |
| Dashboard filters client-side | `Resource.logs().stream` still full bus (P2 footgun) |

**Level vocabulary (already in Store):** prefer `StoreLogLevel` casing — `"All" | "Debug" | "Info" | "Warn" | "Error" | "None"`. Do not reintroduce lowercase `"all"` from older design docs.

---

## Dependency graph

```
B write policy  ──┐
C remote policy ──┼──▶ architecture / API shape locked
stream footgun  ──┘
         │
         ▼
    A (levels) — useful under any B/C; wires into chosen gates
         │
         ▼
    B impl → C impl → docs + changeset(s)
```

**Blocks architecture:** B1/B2/B3 and C1/C2/C3 (plus stream footgun paired with C).  
**Does not block architecture:** exact default levels, `byResource` shim timing, child-runtime docs (still owner-checklist items).

---

## Workstream A — Level pipes

### Intent

Three independent channels + umbrellas on **Resource tag + layer** (Agent 2 plan):

| Combinator | Channel | Gates |
|------------|---------|-------|
| `Resource.logOutputLevel(level)` | Output | Merged Effect `Logger` on resource fibers |
| `Resource.logStreamLevel(level)` | Stream | Live relay eligibility (see gate locus below) |
| `Resource.logStoreLevel(level)` | Store | Durable append eligibility |
| `Resource.logExportLevel(level)` | Stream + store | Shorthand |
| `Resource.logLevel(level)` | All three | Output + stream + store |

**Contract (plan lock unless owner overrides):** layer overrides tag; levels never affect types (`logExportLevel("None")` still leaves `Tag.logs` present if piped).

### Where levels attach today vs target

| Surface | Today | Target under A |
|---------|-------|----------------|
| `Store.logLevel*` on registration | Declared, unused by logs pipeline | Becomes store-channel source under B2; under B1/B3 may map onto the single writer’s filter knobs |
| Resource tag/layer pipes | Missing | New Resource combinators |
| `Logs.persistLayer` / node | No level filter | Node-wide levels — option, see below |

### Open choices (owner)

#### A-gate — Stream channel locus

| Option | Behavior | Upside | Downside |
|--------|----------|--------|----------|
| **A-gate (a)** Before relay publish | Line never enters bus below threshold | Cheapest consumers; bus matches “what we care about” | Irreversible loss of fidelity for late filters / other scopes |
| **A-gate (b)** Filter at tail only | Bus stays full-fidelity; `Resource.logs` / helpers drop under level | Debuggable; other consumers can see dropped noise | Every consumer must apply the gate (or platform helpers must) |
| **A-gate (c)** Independent knobs | Publish gate **and** export-filter level | Max control | Dual config surface; easy to misconfigure |

#### A-default — When is export “on”?

| Option | Meaning |
|--------|---------|
| **A-default (i)** `"All"` until piped quieter | Matches Agent 2 §Open proposal for registrations |
| **A-default (ii)** `"Info"` (or Warn) until piped | Quieter default durable/live noise |
| **A-default (iii)** Inherit `Store.logLevel*` / registration default | One vocabulary with Store; Resource pipes override |
| **A-default (iv)** Off (`"None"`) until explicit pipe / `withLogExport` | Opt-in export; output channel still inherits runtime loggers until `logOutputLevel` set |

#### A-node — Node-wide levels

| Option | Meaning |
|--------|---------|
| **A-node (1)** Resource-only first | Pipes on tags/layers; node `persistLayer` remains unfiltered (or simple Store level later) |
| **A-node (2)** Mirror on node registration / `persistLayer` | Same combinators (or `Logs.logExportLevel`) for the node writer |
| **A-node (3)** Single node knob only | No per-resource levels in P1 — only node-wide floor (shrinks A; conflicts with “Warn-only resource” done-when) |

### Done when (A)

- Combinators exist on Resource (tag + layer override).
- Documented in `docs/LOGS.md`.
- Tests: Warn-only stream and/or store drops Info for that resource (exact gate locus per A-gate).
- Types unchanged by level alone (`.test-d.ts`).

### Sketch files

- `src/Resource.ts` (re-exports) + `src/internal/logs/` (level context / fiber locals or layer config).
- Wire points: relay publish (`internal/logs/relay.ts`), store follower (`storeFollower.ts`), resource fiber logger merge.
- Tests: extend `test/logs-resource.test.ts` / new `test/logs-level.test.ts`.

---

## Workstream B — Store followers / write policy

### Intent

How durable writes attach to store registrations; single-write invariant; where `lineId` comes from; whether `LogStore` stays standalone.

### Options (owner must pick one)

| Option | Behavior | Fit | Cost / risk |
|--------|----------|-----|-------------|
| **B1 — Node-primary (shipped direction)** | One durable writer (`persistLayer`). Resource `query` always filters the node journal by lineage. “Followers” = optional **level/filter** knobs on that one writer, not N writers. | Simplest; matches Phase 5 dashboard (`NodeStatus.logs` + filter). P1 shrinks to levels + docs + maybe memo on the one writer. | No per-resource SQLite partition; `Store.logLevel*` mostly decorative unless remapped onto the node writer |
| **B2 — Registration followers** | Each `Store.register` / toolkit `*.store(tag)` forks a follower that appends when `LogEntry.hasKey(scopeKey)` + `logStoreLevel`. Node registration optional/separate. | Matches original Agent 2 plan; enables per-scope buckets / implicit `appendLog` + `logQuery`. | Duplicate rows if node + resource both write — needs **single-write rule** (below). More moving parts; needs `test/logs-follower.test.ts` |
| **B3 — Hybrid** | Node writer always; resource registrations get **query-only** implicit `logQuery` (reads node journal; no second append). | Middle ground; Store-facing query API without dual writers. | Still no per-resource partition; implicit shapes are read-only; followers conformance is thin |

#### If B2: single-write rule (sub-choice)

| Rule | Behavior |
|------|----------|
| **B2-sw (i)** Node-primary | Node writer wins when both enabled; resource followers no-op append (query-only) |
| **B2-sw (ii)** Resource-primary | Resource followers write; node registration is aggregate/query or opt-in separately |
| **B2-sw (iii)** Mutual exclusion | Config error / layer fail if both node + overlapping resource writers enabled |
| **B2-sw (iv)** Memo-only | Both may run; memo `(scopeKey, lineId)` prevents double-write **per scope** but node bucket + resource bucket can still each hold a copy (duplicate across buckets — clarify if that is OK) |

### Cross-cutting B questions

#### `lineId` / `entryId`

| Option | Today / meaning |
|--------|-----------------|
| **B-id (1)** Keep monotonic node counter | Current `persistLayer` (`Ref` + padded string) |
| **B-id (2)** Content hash | Agent 2 open item — hash(date+message+lineage…); stable across restarts; collision / CPU tradeoffs |
| **B-id (3)** Relay-assigned id at publish | One id for all followers; memo keys off it |

#### Standalone `LogStore` vs `Node.logs` on `Store.Service`

| Option | Meaning |
|--------|---------|
| **B-api (α)** Keep `LogStore` + `Logs.persistLayer` | Minimal churn; docs already SSOT on this |
| **B-api (β)** Replace with `WnbaNodeStore.pipe(Logs.registerNode(WnbaNode))` (sketch) | Unifies node bucket with Store vocabulary; larger refactor; touch `store/log` + examples |
| **B-api (γ)** Keep `LogStore` class API, implement via same follower factory as registrations | Incremental; B2-friendly without deleting `LogStore` |

### Done when (B)

- Owner-picked policy implemented.
- Single-write invariant tested (policy-specific).
- `LOGS.md` write-path diagram matches code.
- If followers: `test/logs-follower.test.ts` — match, memo, level gate.

### Sketch files

- `src/internal/logs/storeFollower.ts` (generalize factory vs keep node-only).
- `src/store/log.ts`, `src/internal/store/logStoreSpec.ts`.
- Store materialization (`Store.register` / `*.store(tag)`) only if B2/B3.
- **Do not** invent handle sugar — Agent D owns named handles.

---

## Workstream C — Remote per-resource logs

### Intent

Remote clients follow/query one resource’s logs without inventing filters at every dashboard. Spec `logs` groups stay **gone** (Phase 5).

### Options (owner must pick one)

| Option | Wire | Client UX | Notes |
|--------|------|-----------|-------|
| **C1 — Keep NodeStatus + filter** | No new RPC. Harden docs + helpers (`Logs.forResource(tag)` / stream filter convenience). | Dashboard stays as today (`src/web/data.ts`). Least platform surface. | “Permanent” means document as the supported pattern, not a stopgap |
| **C2 — Platform-inject on served tags** | Auto-expose `logs.stream` / `logs.query` on every served resource when log export enabled — **not** authored in user control specs. | Restores remote `yield* q.logs`-ish without putting `logs` back in queue/process contracts. | Highest location-transparency; care: injection site, enablement (`withLogExport`?), overlap with Agent D handle naming |
| **C3 — Reserved RPC under NodeStatus** | e.g. `logs.byResource({ key, limit })` + dedicated stream | One RPC home; queue/process stay clean. | Explicit remote API; dashboards migrate off raw filter; not identical to local `Resource.logs` shape unless mirrored carefully |

### P2 footgun (must resolve with C — do not leave ambiguous)

`Resource.logs().stream` is **unfiltered**; `query` is lineage-scoped.

| Option | Behavior |
|--------|----------|
| **C-stream (1)** Pre-filter handle stream with `hasKey(tag.key)` | Local handle matches mental model of `query`; docs simplify |
| **C-stream (2)** Keep unfiltered + named helper + tests | Preserves Agent 2 “bus + site filter”; helpers (`Logs.forResource`) become the safe default |
| **C-stream (3)** Pre-filter only when `withLogExport` / export level implies scoped export; raw `Logs.stream` stays full | Split surfaces — needs sharp TSDoc |

Remote path under C1 naturally mirrors whatever local stream policy is chosen (helpers vs filtered RPC payloads under C3 / injected groups under C2).

### Done when (C)

- Remote path documented in `LOGS.md`.
- Tested over HTTP (extend host-status / queue remote patterns).
- `web/data.ts` either stays on C1 with helpers or migrates to C2/C3.
- Stream footgun resolved and asserted in tests.

### Sketch files

- C1: `src/Logs.ts` / `LogEntry` helpers; `docs/LOGS.md`; maybe `src/web/data.ts` convenience only.
- C2: serve-layer injection near Resource serve (no control-spec `logs` groups).
- C3: `src/NodeStatus.ts` (+ clients / dashboard).
- **Stay out of** Agent D named-handle renames.

---

## Supporting cleanups (bundle with whatever slice touches the file)

| Item | Options / note |
|------|----------------|
| `LogQuery` | Prefer `lineageContains` / `atRoot` / `atLeaf`; deprecate `processId`/`queueId` on `Logs.byResource` — one-release shim OK. Timing = checklist item 8. |
| Child-runtime rule | Document inherit parent `LogRelay` via context **vs** must `provideMerge(Logs.layer)` — pick one rule when docs touched. |
| `withLogExport` vs always-on `Resource.logs` | Keep type story (`Tag.logs` absent without pipe); confirm `.test-d.ts`. Runtime `Resource.logs(tag)` remains available without pipe (today). |

---

## Suggested slice order (for plan text only — owner overrides)

1. Lock **B** and **C** (+ stream footgun) — architecture.  
2. **A** — useful under any B/C.  
3. **B** implementation.  
4. **C** implementation.  
5. Docs + changeset(s).

**Smallest useful P1 profile** (not a winner — one checklist option): **A + C1 + pre-filter `Resource.logs` stream** — no second durable writers (implies B1 or parked B).

### Branch naming (when unlocked)

Per brief: `cursor/logs-p1-<slice>-a009` (e.g. `cursor/logs-p1-a-a009`, `cursor/logs-p1-b1-a009`). Cloud runs append their own suffix policy if different.

### Verification (when implementing)

```bash
pnpm typecheck && pnpm test && pnpm lint
```

Changeset for every public API / behavior change. No `as any` / `as unknown as`.

---

## Owner decision checklist

1. Which workstreams this session? (`A` / `B` / `C` / combinations)  
2. Write policy: **B1** node-primary / **B2** registration followers / **B3** hybrid  
3. If B2: single-write rule when node + resource both enabled (**B2-sw i–iv**)  
4. Stream level gate: before publish vs filter-at-tail (**A-gate a/b/c**)  
5. Remote policy: **C1** / **C2** / **C3**  
6. `Resource.logs().stream`: pre-filter by `hasKey` or keep unfiltered + helpers (**C-stream 1/2/3**)  
7. Replace standalone `LogStore` class with `Node.logs` on `Store.Service`? (**B-api α/β/γ**)  
8. Retire `byResource({ processId, queueId })` timing  
9. Ship smallest P1 (A + C1 + stream filter) vs full plan?

**Also useful if unlocking A immediately:** A-default (i–iv), A-node (1–3), B-id (1–3).

---

## Stop

No code until owner unlocks a named slice. Named handles remain Agent D.
