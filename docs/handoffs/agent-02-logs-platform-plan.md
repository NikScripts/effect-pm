# Agent 2 — Logs platform (one system)

**Status:** **PLAN ONLY** — owner decisions locked in chat; no implementation branch yet.

**Prerequisite:** [`agent-cursor-logs-store-cutover.md`](./agent-cursor-logs-store-cutover.md) (or equivalent) — migrate `LogStore` off `ProcessStore` facet to `Store.contract` + implicit `appendLog` / `logQuery` shapes **before** platform wiring lands.

**Docs bus:** [`agent-status.md`](./agent-status.md) · [`owner-decisions.md`](./owner-decisions.md) · companion (partially stale — see §Overrides): [`store-and-logs-design.md`](./store-and-logs-design.md)

---

## Owner steer (2026-07-13)

- **One simple system** — not `Logs` + `NodeLogs` + duplicate relay impls + a second capture service.
- **`Logs.ts` is old** — refactor it as the **single public logs module**, not a bolt-on around internals.
- **Effect v4 idioms** — match `Store`, `Resource`, vendored `repos/effect`; no v3-style duplicate services or object-namespace engines.
- **No `LogCapture` service** — `LogRelay` is the only bus tag; capture is a **merged `Logger`**, not `yield* LogCapture`.

This handoff is authoritative over `store-and-logs-design.md` where they conflict (§Overrides).

---

## Problem today

| Piece | Issue |
|-------|-------|
| `src/Logs.ts` | Thin re-export shell with **duplicate imports** (`logCapture` + `logPersistRelay` — same relay built twice). PM-era names (`relayWithCaptureLoggerLayer`, `logsRelayLayer`). Still documents `LogStore` / `ProcessStore`. |
| `src/NodeLogs.ts` | Second public module for the same concern (layer, stream, persist, query). **`persistLayer` installs a second capture logger** — violates one-capture rule. |
| `src/internal/manager/logPersistRelay.ts` | Duplicate of `logCapture.ts` relay `Layer.effect`. |
| Queue / Process engines | Per-resource `captureLogs`, private PubSub log forks, `HistoryStore` `${tag.key}/logs` side channel, spec `logs.{stream,query}` on built-in contracts. |
| `src/store/log.ts` | `LogStore` on legacy `ProcessStore` facet — blocks store-follower model. |
| `src/LogContext.ts` | `processId` / `queueId` annotations — legacy; platform converges on **lineage** keyed by `tag.key`. |

---

## Target — one module, one bus, one capture

### Mental model

```
node runtime root
  Logs.layer          → LogRelay (bus) + one merged capture Logger
  withLogScope(tag)   → at each resource materialize: append tag.key to fiber lineage
  Store followers     → fork subscriber on LogRelay.publish; default match LogEntry.hasKey(scopeKey)
  Resource.logs(tag)  → { stream, query } — no handle sugar on yield* Tag
```

- **Capture:** exactly **one** merged capture logger per node runtime (`Logs.layer`).
- **Bus:** exactly **one** `LogRelay` `Context.Service` — PubSub + bounded snapshot tail.
- **Stream:** **unfiltered** bus; consumers use `Stream.filter` + `Predicate.Predicate<LogEntry>`.
- **Store:** bus subscribers per registration; **memo `(scopeKey, lineId)`** so the same line is not double-appended to the **same** scope (cross-scope duplication is intentional when lineage contains multiple keys).
- **Types:** `LogEntry` / `LogEntrySchema` (schema A). Domain metrics unchanged (`metrics.{stream,query}`).

### Vocabulary (locked)

| Term | Meaning |
|------|---------|
| **Node** | Runtime host (OS process). |
| **Group** | Org only (`Group.members`); **does nothing** for logs. |
| **`groupId`** | RPC wire prefix — **not** a log node. |
| **`tag.key`** | Resource identity (long, may contain `/`). Lineage segments use this. |

---

## Public module shape (Effect-true)

**One public module:** `src/Logs.ts` — flat top-level exports; file **is** the namespace (`import * as Logs from "…/Logs"`).

**Retire** public `NodeLogs.ts` — re-export shims only if a changeset migration window needs them; end state is `Logs` only.

### `Logs.ts` public surface (target)

| Export | Role |
|--------|------|
| `Relay` | `LogRelay` `Context.Service` tag |
| `layer` | Node root: `Layer.merge(relayLayer, Logger.layer([captureLogger], { mergeWithExisting: true }))` |
| `stream` | `Stream<LogEntry, never, Relay>` — unfiltered live bus (+ snapshot prefix) |
| `snapshot` | `Effect<ReadonlyArray<LogEntry>, never, Relay>` |
| `replay` | `replayLogEntry` — operator replay through ambient Logger |
| `withScope` | `withLogScope(tag)` — lineage reducer at materialize (name TBD; **not** blind nested `annotateLogs` on same keys) |
| `filter` | Convenience: `Stream.filter` + `Predicate` helpers (thin; optional) |

**Not on `Logs`:** store registration, `Resource.logs`, tag pipe combinators — those live on `Resource` / `Store` where they attach.

### `LogEntry.ts` additions

```ts
// Predicate helpers — default for store match + common stream filters
LogEntry.lineage(entry): ReadonlyArray<string>   // decode from annotations JSON
LogEntry.hasKey(key): Predicate<LogEntry>        // key anywhere in lineage
LogEntry.atRoot(key): Predicate<LogEntry>         // lineage[0] === key
LogEntry.atLeaf(key): Predicate<LogEntry>         // last segment === key
```

Persisted lineage: **JSON-encoded** `string[]` in annotations (single key, e.g. `@nikscripts/effect-pm/lineage`). Legacy `queueId` / `processId` → migrate reads to lineage; writers stop emitting legacy keys once cutover completes.

### `Resource.logs` / `Tag.logs` (platform attach)

```ts
const { stream, query } = yield* Resource.logs(MyQueue);
// stream: unfiltered — filter at site
stream.pipe(Stream.filter(LogEntry.hasKey(MyQueue.key)));
yield* query({ limit: 100 });
```

```ts
// When tag piped with log export — type member present; absent when not piped
yield* MyQueue.logs;
```

**Rejected:** `yield* MyQueue` does **not** gain `.logs` (no handle sugar).

**Config pipes** (on **tag** and **layer** — layer overrides tag; levels never affect types):

| Combinator | Channel |
|------------|---------|
| `logOutputLevel` | Merged Effect `Logger` on resource fibers |
| `logStreamLevel` | Live relay (level gate before publish) |
| `logStoreLevel` | Durable append follower |
| `logExportLevel` | stream + store |
| `logLevel` | all three |

`logExportLevel("none")` silences at runtime; if tag still piped for export, **type unchanged**.

### Store integration

Each `Store.register` / `Resource.withStore` materialization forks a **follower** on `Relay.publish`:

1. Level gate from registration (`logStoreLevel` / `Store.logLevel*` today → split into store channel).
2. Default row match: `LogEntry.hasKey(scopeKey)`.
3. Memo `(scopeKey, lineId)` per follower.
4. Implicit shapes: `appendLog: Store.append(LogEntrySchema)`, `logQuery: Store.query(…)`.

**Node-wide bucket:** separate registration on node store class (sketch: `Node.logs` / `Logs.registerNode` on `Store.Service`) — entire runtime, `groupId` = node id. Same follower pattern.

Standalone `Resource.withStore` / `Store.effects` materializations use the same follower when scope is registered (default-memory follower when only `layerDefaultMemory`).

---

## Store naming (locked 2026-07-13)

**Removed:** `Store.store` (overloaded, `Store.store` reads absurd).

| Role | API |
|------|-----|
| Tag pipe — adds `yield* Tag.store` | `Resource.withStore(contract)` |
| Single-scope class + `layerMemory` / `layer` (no `class extends`) | `Store.scoped(scope, contract)` — tests/escape hatch only |
| Aggregate registration on `Store.Service` | `Store.register(scope, contract)` — custom `{}` entries |
| Multi-scope app DB | `Store.Service` |

`Store.scoped` was briefly `Store.Scope` — rejected (clashes with `effect/Scope`).

### `Store.Service` input shapes (locked 2026-07-13)

Three forms only. Registration for toolkit resources is always **`QueueResource.store(tag, additions?)`** /
**`RunResource.store(tag)`** / **`Process.store(tag)`** — not raw `(tag, contract)` on `Service`.

| Form | Example | Acquire |
|------|---------|---------|
| **Single store** | `Store.Service(id)(QueueResource.store(Mail))` | `yield* MailStore` — service type **is** the handle |
| **Tag-keyed multi** | `Store.Service(id)([QueueResource.store(Mail), RunResource.store(Gate)])` | `yield* AppStore.at(Mail)` |
| **Custom-keyed** | `Store.Service(id)({ mail: QueueResource.store(Mail), audit: spec })` | `yield* AppStore.at("audit")` / named bundle accessors |

**Single store is not an aggregate.** One registration passed bare (not `[]`, not `{}`) → flat
`StoreHandleFromContract`, no `.at()`. Layers unchanged: `MailStore.layer({ filename })`.

**Do not use** `Store.scoped` for app single-resource SQLite — use `class MailStore extends
Store.Service<MailStore>(…)(QueueResource.store(Mail))`.

**Implementation:** branch in `defineStoreTag` when `normalizeStoreRegistrations` yields exactly one
entry — `Context.Service` carries the handle directly; multi keeps `StoreBundle` + `at`.

---

## Internal layout (refactor)

Collapse duplication; name-mirror internal impl.

| Today | Target |
|-------|--------|
| `internal/manager/logCapture.ts` | `internal/logs/relay.ts` — `LogRelay`, `layer`, `captureLogger`, `replayLogEntry` |
| `internal/manager/logPersistRelay.ts` | **Delete** — duplicate |
| `internal/manager/logQuery.ts` | `internal/logs/query.ts` — payload decode; public `LogQuery` type may move to `Logs.ts` or stay colocated |
| `internal/manager/logScope.ts` | `internal/logs/scope.ts` — CLI target resolution; rewrite matchers to `LogEntry.hasKey` / lineage |
| `NodeLogs.persistLayer` queue writer | `internal/logs/storeFollower.ts` — one follower factory used by node + per-scope registration |

`Logs.ts` = thin public shell: `import * as internal from "./internal/logs/relay"` pattern (same as `Cache.ts` ↔ `internal/cache.ts` in Effect).

**v4 rules for new code:**

- `Context.Service` + `Layer.effect` for `Relay` (already correct in `logCapture.ts`).
- `Logger.make` sync body; publish via `fiber.currentDispatcher.scheduleTask` + `Effect.runForkWith(context)` — **no** effect-returning loggers.
- No second `Context.Service` for capture.
- `Effect.gen` with bare `yield*` only where gen is warranted; prefer pipe for simple maps.
- `Predicate`, `Stream.filter`, `Schema` for wire — no `as any`.
- Platform/node work via `FileSystem` / `ChildProcess` etc. when touched; no new raw `node:*`.

---

## Overrides vs `store-and-logs-design.md`

| Stale in design doc | Locked here |
|---------------------|-------------|
| `LogsHandle.tail` | **`stream`** (unfiltered) + **`query`** |
| `tail` + client-side only | **`Stream.filter`** + `LogEntry.hasKey` / `atRoot` / `atLeaf` |
| `NodeLogs.layer` / `NodeLogs` module | **`Logs.layer`** / single **`Logs`** module |
| Separate `LogCapture` / dual capture paths | **`LogRelay` only** + one merged capture logger |
| `processId` / `queueId` as primary resource identity | **`tag.key` in lineage** |

---

## Migration phases

### Phase 0 — Today (baseline)

`captureLogs`, engine log PubSubs, `HistoryStore` log streams, spec `logs.{stream,query}`, `LogStore` facet, `Logs` + `NodeLogs` split.

### Phase 1 — LogStore cutover (prerequisite)

- `LogStore` → `Store.contract` implicit log shapes on registrations.
- Delete `ProcessStore` log facet.
- Handoff: `agent-cursor-logs-store-cutover.md`.

### Phase 2 — Consolidate relay + `Logs` module

- Delete `logPersistRelay.ts`; single relay in `internal/logs/relay.ts`.
- Refactor public `Logs.ts` (`layer`, `stream`, `snapshot`, `replay`, `withScope`).
- Deprecate `NodeLogs` → alias to `Logs` (one release) then remove.
- Remove `NodeLogs.persistLayer` second-logger pattern.

### Phase 3 — Lineage + unified capture

- `withLogScope(tag)` reducer at resource materialize (Process, Queue, RunResource, custom).
- `LogEntry` predicates + annotation codec.
- Replace per-engine `captureLogs` loggers with scope annotation only (capture stays at node `Logs.layer`).
- Level gates on publish path (`logStreamLevel`) and store followers (`logStoreLevel`).

### Phase 4 — `Resource.logs` + store followers

- `Resource.logs(tag)` / conditional `Tag.logs`.
- Tag/layer pipe combinators (`logOutputLevel`, …).
- Node registration helper on `Store.Service`.
- Memoized followers; wire `query` to `logQuery` shape.

### Phase 5 — Remove legacy surfaces

- Delete spec `logs` groups from built-in contracts (breaking).
- Remove `captureLogs` config, `HistoryStore` log ids, engine log fork fibers.
- CLI/dashboard: `Logs.stream` + filters; `Resource.logs` for per-resource reads.
- Retire `LogContext.withProcessLogAnnotations` / `withQueueLogAnnotations` (shim to lineage during migration).

### Phase 6 — Docs, changeset, conformance

- Update guides (replace `captureLogs` / `NodeLogs` examples).
- Conformance: relay snapshot capacity, follower memoization, `hasKey` match, level gates.
- `.test-d.ts`: `Tag.logs` absent without export pipe; present when piped.

---

## Open implementation details

1. **`lineId` derivation** — stable per captured line (hash of date+message+lineage vs monotonic node counter).
2. **`LogQuery` payload** — evolve from `processId`/`queueId` to `lineageContains?: string` + `atRoot?` / `atLeaf?`; keep legacy fields one release.
3. **Node store levels** — mirror tag pipe API on node registration vs single `logExportLevel` on `Logs.layer`.
4. **Remote `Resource.logs`** — RPC path for `stream` (subscription) + `query` (`effectFn`); naming follows observability `stream`/`query` group.
5. **Child runtimes** — `Logs.layer` on child scope: inherit parent relay via context copy or explicit `Layer.provideMerge` (document one rule).
6. **Default export level** — proposal: `logExportLevel("all")` on registrations unless piped; output channel inherits runtime loggers until `logOutputLevel` set.

---

## Verification (when implementing)

```bash
pnpm typecheck   # all projects including strict-provide
pnpm test
pnpm lint
```

Add:

- `test/logs-relay.test.ts` — one capture, snapshot + pubsub, no duplicate publish.
- `test/logs-follower.test.ts` — `hasKey` match, memoization, level gate.
- `test/logs-resource.test.ts` — `Resource.logs`, `Tag.logs` typing (`.test-d.ts`).
- Conformance adapter if log store gets sqlite backing.

**Changeset:** required — public API (`NodeLogs` removal, `Logs` surface, built-in spec `logs` removal, `captureLogs` removal).

---

## Suggested first PR slice (after Phase 1)

**Branch:** `cursor/logs-consolidate-relay-a3ad`

1. Internal: merge relay impl; delete `logPersistRelay.ts`.
2. Public: refactor `Logs.ts` with `layer` / `stream` / `snapshot` / `replay`.
3. `NodeLogs` → re-export deprecated aliases from `Logs`.
4. Tests proving **one** publish per log line with `Logs.layer` only (no `persistLayer` logger).
5. No `Resource.logs` yet — mechanical cleanup only, green CI.

Owner approval before Phase 4+ (breaking built-in spec / `captureLogs` removal).
