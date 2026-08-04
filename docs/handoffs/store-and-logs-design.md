# Design: Store, platform logs, and live vs durable observability

> **Naming:** read as WorkPool / Daemon / Gate / Hyperlink / hyperlink-ts (pre-rebrand names purged from this file).

**Status:** Store contract API shipped. **Backing:** `effect/unstable/eventlog` (`EventJournal` +
`SqlEventJournal`) — see `docs/guides/store-backing.md`. Platform logs remain future work.

Companion to the Store API consensus (Thermometer, `Store.append` / `Store.query`, `Hyperlink.store`,
`Store.Service` backing). This doc covers **platform logs**, **naming**, **tag accessors**, **log-level
pipe API**, and the **still-open** pattern for domain refs/streams vs storage.

---

## Store API (recap — agreed)

### Spec builders (`Store.ts`)

| Builder | Shape | Role |
|---------|-------|------|
| `Store.shape(row, readPayload?)` | `store.<shape>.append` / `.read` | Part 1 shape with optional read query payload |
| `Store.contract(shapes, methods?)` | shape namespaces + flat custom methods | compile contract (pipeable) |
| `Store.append(schema)` | `(payload) => Effect<void>` | legacy flat append entry |
| `Store.query({ payload, result })` | `(payload) => Effect<result>` | legacy flat query entry |

Method names come from **keys in the store spec object**.

### Avoid at call sites

Do **not** define resource or store contracts with **`as const` + `satisfies`** (or lean on that
combo as the "typed spec" pattern):

```ts
// ❌ avoid — inference workaround; pushes complexity onto every consumer
const thermometerStore = {
  readings: Store.append(readingSchema),
} as const satisfies StoreSpec;
```

Use **`Hyperlink.contract({ … })`** / **`Store.contract({ … })`** instead — the builder owns
narrowing (same role as `Hyperlink.local`, `Hyperlink.effect`, `Store.append`):

```ts
// ✅
const thermometerContract = Hyperlink.contract({
  temperature: Hyperlink.ref(Schema.Number),
});
const thermometerStore = Store.contract({
  readings: Store.append(readingSchema),
});
```

Bare `{ … } as const` without a builder is tolerable only as a legacy interim; new store/resource
definitions should go through **`contract`**.

### `Store.Service` — app aggregate (class factory)

**Naming:** sketched early as `Store.descriptor`; locked name is **`Store.Service`** (Effect-style
double-call factory — same family as `Hyperlink.Service`, legacy `DaemonStore.Service`).

Apps declare **one store class per deployment / DB file**. That class is the **shared backing**:
SqlClient (or memory), registration table, migrations, retention — **not** a grab-bag of domain
methods. Domain read/write surfaces come from **per-hyperlink registrations** piped onto the class.

```ts
export class DropletStore extends Store.Service<DropletStore>()("@repo/app/Store").pipe(
  WorkPool.store(Mail),
  Daemon.store(Daily),
  LabThermometer.store,
  Hyperlink.store(OtherGauge, privateStoreSpec), // merges with tag public store spec (see below)
) {}

Effect.provide(app, DropletStore.layer({ filename: ".hyperlink-ts/data.sqlite" }));
```

**Node-scoped store** (runtime-wide logs + future node-only facets) — separate registration, not
`Logs.store()` on the app class:

```ts
export class WnbaNodeStore extends Store.Service<WnbaNodeStore>()("@repo/WnbaNodeStore").pipe(
  WnbaNode.logs, // entire runtime on this node — tail + durable query
  // WnbaNode.store — future node-scoped domain storage if needed
) {}

// or helper sketch: Store.Service.forNode(WnbaNode).pipe(WnbaNode.logs, …)
```

Minimal app (single custom resource):

```ts
export class AppStore extends Store.Service<AppStore>()("@app/Store").pipe(
  LabThermometer.store,
) {}
```

When the resource tag has **no** embedded store spec, register private facets on the app store:

```ts
export class AppStore extends Store.Service<AppStore>()("@app/Store").pipe(
  Hyperlink.store(LabThermometer, privateStoreSpec), // appended to any public store spec on tag
) {}
```

#### Registration pipe args

| Pipe arg | When |
|----------|------|
| `Tag.store` | Tag materialized with `.pipe(Hyperlink.store(publicStoreSpec))` — **public** store; always on `Tag.store` |
| `Hyperlink.store(Tag, storeSpec)` | **Private** (or extra) facets — **merged** onto the tag's public store spec at registration |
| `WorkPool.store(Tag)` | Built-in queue storage registration |
| `Daemon.store(Tag)` | Built-in process storage registration |
| `Node.logs` | **Node runtime-wide** logs (entire process), not a separate `Logs.store()` |

**There is no `Logs.store()` on `Store.Service`.** Platform log **storage** is built into each
resource registration (implicit `appendLog` / `logQuery` facets). Node logs use **`Node.logs`**
(or equivalent) as their own registration on the same or a sibling store class.

#### Public vs private store specs (merge)

Store specs are **extendable**. Keys become method names on the merged handle.

| Layer | Declaration | On `yield* Tag.store` |
|-------|-------------|------------------------|
| **Public** | `.pipe(Hyperlink.store(publicStoreSpec))` on the tag | Always included |
| **Private** | `Hyperlink.store(Tag, privateStoreSpec)` on `AppStore` | Appended at registration |

You may put the entire store spec on the tag (fully public). Private facets are for app-only
persistence (executions, audit) without exposing methods on the shared tag type.

```ts
const publicStoreSpec = Store.contract({ readings: Store.append(readingSchema) });
const privateStoreSpec = Store.contract({ audit: Store.append(auditSchema) });

class LabThermometer extends Hyperlink.Service<LabThermometer>()(key, contract).pipe(
  Hyperlink.store(publicStoreSpec),
) {}

export class AppStore extends Store.Service<AppStore>()("@app/Store").pipe(
  Hyperlink.store(LabThermometer, privateStoreSpec),
) {}
// handle = public ∪ private at runtime; Tag.store type reflects public only unless typed otherwise
```

#### Standalone contract / store definitions (shipped)

Use **`Hyperlink.contract({ … })`** / **`Store.contract({ … })`** — the builder owns narrowing:

```ts
const thermometerContract = Hyperlink.contract({ … });
const thermometerStore = Store.contract({
  readings: Store.shape(readingSchema, listReadingsPayload),
});
class LabThermometer extends Hyperlink.Service<LabThermometer>()(key, thermometerContract).pipe(
  Hyperlink.store(thermometerStore),
) {}
```

**Name:** `Hyperlink.contract` / `Store.contract` — locked.

**Do not confuse with the gutted multi-host DSL** (same name, different feature — see
`docs/handoffs/multi-host-instances-decisions.md` § "Gutted"): that was
`Hyperlink.contract(…).pipe(Hyperlink.multi((m) => ({ … m.query … })))`, a special **field kind** for
combined fleet queries. It was removed because fleet fields are plain methods tagged
`Hyperlink.fleet`, folded in the layer via `Hyperlink.peers` + `hyperlink-ts/MultiHost`
primitives — not because standalone contract builders were rejected.

Providing `AppStore.layer` / `DropletStore.layer` wires every registration in the pipe to the same
in-memory backing today (`layer({ filename })` accepts options but still uses memory until the SQLite
adapter lands). **No backing layer** (or store not in the pipe) → per-registration **no-op stub** (void
writes, empty reads).

#### Runtime handles (on the resource, not on `AppStore`)

Registration is declared on `AppStore`; **handles are acquired from the resource tag** at use sites:

```ts
const store = yield* LabThermometer.store; // Path A — spec on tag
yield* store.readings(payload);

const store = yield* Hyperlink.store(LabThermometer, thermometerStoreSpec); // Path B — external spec
```

### Resource attachment (tag-side)

**Path A — store spec on tag:**

```ts
class LabThermometer extends Hyperlink.Service<LabThermometer>()(
  "@app/LabThermometer",
  thermometerSpec,
).pipe(Hyperlink.store(thermometerStoreSpec)) {}

const store = yield* LabThermometer.store;
```

**Path B — store spec external** (register on `AppStore` via `Hyperlink.store(Tag, spec)`; acquire with
`yield* Hyperlink.store(Tag, spec)` or equivalent).

- Scope column from `tag.key` — not repeated in every payload.

### Store features (agreed)

- `layerMemory` / `layer({ filename })`
- `appendBatch` when append schema is array
- `Store.changes(tag)` — pubsub tail of writes (operator/plumbing; not dashboard primary)
- Retention (`maxRows`, …) on registration
- Spec versioning + migrations on layer open
- Conformance tests per store spec

### Durability (separate concern)

Queue `persist: true` uses durability port (`DurableWorkPoolStore` semantics). Same DB file possible via
shared `SqlClient`; not part of store contract.

---

## Platform logs — not on user contracts

Logs are **not domain**. Remove `logs: { … }` from `queueControlSpec`, `processSpec`, custom specs, etc.

### Read API

Canonical:

```ts
const handle = yield* Hyperlink.logs(MyQueue);
handle.tail;                              // live watch
yield* handle.query({ limit: 100 });      // durable read
```

Sugar (same object, platform-attached):

```ts
const q = yield* MyQueue;
q.logs.tail;
yield* q.logs.query({ limit: 100 });
```

Tag accessor (like `.store`):

```ts
yield* MyQueue.logs;   // Effect<LogsHandle, …, MyQueue> — when logs enabled on tag
yield* MyQueue.store;  // Effect<StoreHandle, …, MyQueue> — when store registered
```

Both `Hyperlink.logs(tag)` and `Tag.logs` exist; different call sites (CLI/routing vs handle sugar).

### Visibility when disabled

- **Type level:** if the tag was not piped with log export (or explicitly `logExportLevel("none")`),
  `Tag.logs` is **absent from the type** (same pattern as optional `.store`).
- **Runtime:** `Hyperlink.logs(tag)` on a tag without logs → empty tail stream, `query` returns `[]`
  (or `Effect.fail` with a tagged `LogsNotEnabled` — pick one at implement time; prefer empty/no-op
  for dashboard simplicity unless explicitly silenced vs never configured need different UX).

### Built-in log facets (per resource registration — not a separate `Logs.store()`)

Every **resource** store registration implicitly includes platform log facets (not authored in the
user store object):

```ts
// implicit on each Tag.store / Hyperlink.store(Tag, …) registration
appendLog: Store.append(LogEntrySchema);
logQuery:  Store.query({ payload: logQuery, result: Schema.Array(LogEntrySchema) });
```

**Per-hyperlink configuration** is on the **tag** (same place as store attachment):

```ts
class MyQueue extends WorkPool.Service<MyQueue>()("…", JobSchema).pipe(
  Hyperlink.logStoreLevel("info"),   // durable append via this tag's registration
  Hyperlink.logStreamLevel("warn"),  // tail relay for this resource only
  Hyperlink.logOutputLevel("debug"), // merged Logger on resource fibers
  Hyperlink.logExportLevel("info"),  // stream + store together
) {}
```

### Single capture, single store write (design rule)

Multiple **tails** (per-hyperlink + node) are fine; **durable storage must not duplicate the same
line** across registrations.

```
 runtime root (node)                    resource fiber
        │                                      │
        ▼                                      ▼
  NodeLogs.layer (capture once)         resourceId annotation
        │                                      │
        ├──────── tail: Node.logs ─────────────┤ filter by level (stream)
        │                                      │
        └──────── store writer ────────────────┘ one append path per line
                    │
            Store.Service (one DB)
            ├─ node registration (Node.logs)     — entire runtime, bucket = node
            └─ resource registration (Tag.store) — scoped by tag.key + implicit appendLog
```

**Locked intent:**

1. **Capture** — one merged capture logger at the node runtime root (today's `NodeLogs.layer`
   direction); resource fibers carry `resourceId` / legacy `queueId` / `processId` annotations.
2. **Tail** — per-hyperlink relay filtered by annotation + `logStreamLevel`; node relay sees all
   lines (`Hyperlink.logs` / `Node.logs` read API).
3. **Store** — one durable append per log line. **`logStoreLevel` on the tag** gates whether a line
   is appended to **that resource's** registration `appendLog`. Node durable export uses
   **`Node.logs`** registration (and node-level level config — TBD mirror of pipe API). Avoid
   registering both node and resource store paths that write the same line; prefer node bucket for
   cross-resource queries and resource registration for resource-scoped tables when only one writer
   is active.

Replace: `captureLogs` on queue/process config, `HistoryStore` `${tag.key}/logs` side channel,
per-engine log fork fibers, and **`Logs.store()` on `Store.Service`**.

Write path at resource materialize:

1. Annotate fibers with `resourceId: tag.key`.
2. Merge capture logger (levels from tag pipe config).
3. Fan to tail relay + at most **one** store append eligible for that line.

### Node-wide logs

**Node logs = entire runtime** on that node (complement to per-hyperlink `Hyperlink.logs(tag)`).

```ts
const handle = yield* WnbaNode.logs;           // or Hyperlink.nodeLogs(WnbaNode)
handle.tail;
yield* handle.query({ limit: 500 });           // all resources on this node

const q = yield* MyQueue;
yield* q.logs.query({ limit: 100 });           // this resource only
```

Register node storage on a store class via **`Node.logs`** (or `Store.Service` helper with node
context — exact API TBD). Same `Store.Service` DB file can host both `AppStore` and `WnbaNodeStore`
registrations via shared `SqlClient`.

Legacy `NodeLogs.persistLayer` + `LogStore` → folds into this model.

---

## Naming: alternatives to `live` / `history`

### Platform logs (`Hyperlink.logs`)

| Option | Tail (was `live`) | Durable (was `history`) | Notes |
|--------|-------------------|-------------------------|-------|
| **A (recommended)** | `tail` | `query` | Matches log UX; `query` aligns with `Store.query` |
| B | `follow` | `replay` | Action verbs; good for docs |
| C | `watch` | `read` | Dashboard-friendly; `read` is generic |
| D | `relay` | `archive` | Matches internal relay/store plumbing |

**Locked proposal:** **`tail`** + **`query`** on `LogsHandle`.

```ts
interface LogsHandle {
  readonly tail: Stream.Stream<LogEntry>;
  readonly query: (options?: LogQuery) => Effect.Effect<ReadonlyArray<LogEntry>>;
}
```

### Domain observability (metrics, readings, executions — still on contract)

Do **not** reuse log names on domain groups. Recommended pair for nested contract fields:

| Option | Ephemeral SSOT | Durable read |
|--------|----------------|--------------|
| **A (recommended)** | `stream` (leaf: `Hyperlink.stream`) | `query` (leaf: `Hyperlink.effect` + store) |
| B | `live` | `history` | Current queue/process naming (migrate later) |
| C | `watch` | `read` | |

Example (Thermometer metrics — domain, not logs):

```ts
readings: {
  stream: Hyperlink.stream(reading),           // discrete events / windows
  query:  Hyperlink.effectFn(readingQuery, Schema.Array(reading)),
}
```

**Open:** migrate queue/process from `stream`/`query` → `stream`/`query` in one breaking pass, or
keep legacy names until store migration lands. See §Open questions.

### Refs vs streams vs store (domain state) — see §Observability contract standard

The metrics nested group is **one** of four observability shapes. Full rules, decision tree, and
queue/process inventory are in **§Observability contract standard** below.

---

## Log level pipe API (on tag)

Three independent channels + one umbrella:

| Channel | Controls | Pipe combinator |
|---------|----------|-----------------|
| **Output** | Effect `Logger` merged into resource fibers (console/etc. via existing loggers) | `Hyperlink.logOutputLevel(level)` |
| **Stream** | Live tail relay (`LogsHandle.tail`) | `Hyperlink.logStreamLevel(level)` |
| **Store** | Durable append (`appendLog`) | `Hyperlink.logStoreLevel(level)` |
| **Export** | Stream + store together | `Hyperlink.logExportLevel(level)` |
| **All** | Output + stream + store | `Hyperlink.logLevel(level)` |

Levels: `"all" | "debug" | "info" | "warn" | "error" | "none"` (align with Effect `LogLevel`; `"all"`
= capture everything including trace).

**Defaults (proposed):** export = `"all"` (debug and above into tail + store); output = inherit runtime
(existing loggers unchanged unless `logOutputLevel` set).

**Shorthand sugar** (set all three to the same level):

```ts
Hyperlink.logLevelNone
Hyperlink.logLevelError
Hyperlink.logLevelWarn
Hyperlink.logLevelInfo
Hyperlink.logLevelDebug
// equivalent to Hyperlink.logLevel("none" | "error" | …)
```

**Examples:**

```ts
class MyQueue extends WorkPool.Service<MyQueue>()("…", JobSchema).pipe(
  Hyperlink.logStoreLevel("none"),      // tail only, no SQLite rows
  Hyperlink.logStreamLevel("warn"),     // tail warns+
  Hyperlink.logExportLevel("info"),     // tail + store info+
  Hyperlink.logLevel("debug"),          // output + stream + store all debug+
) {}
```

Avoid bare `Hyperlink.logLevelNone` without docs — name makes clear it silences **resource log
export** (all channels when used as shorthand; prefer `logExportLevel("none")` when only disabling
persistence).

---

## `Store.changes(tag)` — applications

Low-level append tail for one registration. Not the dashboard primary.

- Audit / operator watch when no contract stream exists (executions, facts)
- Cross-resource triggers
- Tests asserting append order
- Read-model materialization

Dashboard prefers `Hyperlink.changes(tag, refField)` or domain `*.stream` / `LogsHandle.tail`.

---

## Migration targets (when implemented)

**Delete / replace**

- Public `RuntimeStorage`, `Query`, `DaemonStorage`
- Public `src/store/*` facet tags + static emitters
- `logs: { stream, query }` on resource specs
- `captureLogs` on queue/process layer config
- Ad-hoc `HistoryStore` log stream ids (metrics may follow separately)

**Add**

- `Store.ts` module + `Hyperlink.store` + `Store.Service`
- `Hyperlink.logs` + `Tag.logs` + implicit log store facets
- Log level pipe combinators
- Thermometer reference resource
- Conformance + `.test-d.ts` for new surfaces

---

## Open questions

1. **Domain naming migration:** `stream`/`query` → `stream`/`query` on queue/process metrics/logs
   groups in same changeset as store, or logs-only first?
2. **Node log store levels:** mirror tag pipe API on `Hyperlink.Node` vs node-only config on
   `Node.logs` registration?
3. **Single-write policy:** node registration owns all durable lines vs resource registration only
   when `logStoreLevel` ≠ `none` — exact routing when both node and resource export are enabled.
4. **`LogsNotEnabled` vs empty:** strict fail for misconfigured CLI vs silent empty for dashboard.
5. **Ref → store sampling:** platform helper for status history, or never?
6. **Wire injection:** platform procedures for `logs.tail` / `logs.query` on served tags — exact RPC
   path naming (`__logs.tail` vs nested group flatten).

---

## Verification (when implementing)

- `pnpm typecheck` (all projects)
- `pnpm test` + new conformance suites
- `pnpm build` + `npm run treeshake`
- Changeset for public API / removed subpaths
