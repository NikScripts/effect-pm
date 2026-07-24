# hyperlink-ts

## 0.9.0-beta.0

**The rebrand release.** `hyperlink-ts` continues the `@nikscripts/effect-pm` line: the 0.8 betas
were effect-pm; the 0.9 betas are **Effect Hyperlink**. The web made documents
location-transparent; Hyperlink does it for Services. This entry consolidates the ~200 changesets
accumulated since 0.8.0-beta.28.

### Major: package and primitive rename

- npm name: `@nikscripts/effect-pm` → **`hyperlink-ts`** (unscoped). Import subpaths follow
  (`hyperlink-ts/Hyperlink`, `hyperlink-ts/Node`, ...). Wire ids, `Symbol.for` keys, and Context
  ids move from `@nikscripts/effect-pm/...` to `hyperlink-ts/...`.
- The primitive `Resource` is now **`Hyperlink`**: module, namespace, and every foundation symbol
  (`ResourceTag` → `HyperlinkTag`, `DuplicateResourceKey` → `DuplicateHyperlinkKey`, …). The
  advanced-authoring bundle is **`Hyperlink.Driver`** (was `BuiltResource` / briefly
  `BuiltHyperlink`); `ServedHyperlink*` is `@internal`.

### Major: kinds renamed to generic nouns, variants folded

- `QueueHyperlink` → **`WorkPool`** · `RunHyperlink` → **`Gate`** · `Process` → **`Daemon`**.
  Gate wire helpers follow: `runGateStatus` / `runSpec` / `RunInstanceSpec` /
  `RunGateStatus` / `RunGateHandle` → `gateStatus` / `gateSpec` / `GateInstanceSpec` /
  `GateStatus` / `GateRunHandle`. `HttpClientRunGate` → **`HttpClientGate`**
  (subpath too). `DaemonDefinition.process` → **`daemon`**.
- `CustomQueueHyperlink` folds into **`WorkPool.priority(...)`** (peer constructor beside
  `WorkPool.Tag`; `layer`/`serve`/`store`/`configure` dispatch on the tag; engine stays
  tree-shakeable as `WorkPool.makePriority`). Subpath removed. Public wire helpers rename
  with it: `customQueueStatus` / `customQueueSpec` / `CustomQueueTagConfig` / … →
  `priorityStatus` / `prioritySpec` / `PriorityTagConfig` / ….
- `HttpApiHyperlink` folds into **`Gate.httpApiClient(...)`** (+ `httpApiClientService`,
  `httpApiClientLayer`, `acceptJson`, `instrumentEndpoints`). Subpath removed.
- Priority-lane vocabulary unified to **lane**: `laneCount`, `namedLanes`, `add(item, lane?)`.
- **One kind per resource (SSOT):** the short `"queue"` / `"process"` discriminator is gone.
  Definitions and dashboard guards use the stamped kind (`WorkPool.kind` /
  `Daemon.kind` / `Hyperlink.kindOf(tag)`).
- **`BuiltHyperlink` → `Hyperlink.Driver`** (`driver` / `isDriver` / `driverSym`).
  `ServedHyperlink` / `ServedHyperlinks` / `servedHyperlinksLayer` demoted to `@internal`.
- **Node status/logs/ping live on the connected node handle** — `(yield* node).status` /
  `.logs` / `.ping`. The `NodeStatus` module and `Node.status` namespace are **removed**.
  Light types survive as `Node.Status` / `Node.ResourceReadiness` /
  `Node.resourceReadiness`.

### Nodes, transports, and loud failures

- Two-stage tag factories: `Node.Tag<Self>()("name", target)` (and Lookup), eliminating
  context-inference false positives structurally.
- Multi-protocol nodes: http, WebSocket, unix socket, and named-pipe servers/dialers with
  protocol-precise kinds.
- **Client transport surface:** two families — `Hyperlink.connect(tag, protocol)` (bring your
  own wire) and `Hyperlink.http` / `ws` / `unix` / `nPipe(node)` (batteries). **`clientHttp`
  removed** — migrate to `connect(tag, protocolHttp(target))`. Bare-port dials resolve via
  `Hyperlink.clientHost` (`HYPERLINK_CLIENT_HOST`, default `localhost`).
- Reserved wire ids drop the old `@pm/…` prefix: node-status is
  `hyperlink-ts/node-status` (was `@pm/node-status`); ephemeral verify/lookup probe node keys
  use `hyperlink-ts/verify/…` and `hyperlink-ts/lookup-*/…`.
- Transport wiring fails **loud and typed** (`ProtocolUnanswered`, `UnaddressedNode`,
  contract-hash verification, deep `verifyConnection`); silent-wiring paths removed.
- Per-resource serving with isolated deps on one `/rpc`; listen/local catalogs; RPC transport is
  an injected dependency (`layerProtocol`, `wsServer`).

### Lookup and fleet

- `Identity.claim` (first-wins, dead-incumbent replacement via node-handle ping),
  `Directory.advertise`/`resolve`/`nodesServing` (`IncumbentAlive` guard), and placement
  **Advice** (`advise`/`preferred`/`clearAdvice`).
- Peers model (`Hyperlink.nodes([...])`) for multi-node placement; `FleetHealth`, `ShardMap`,
  and fleet `Telemetry` surfaces.

### WorkPool, Daemon, Polling

- WorkPool: refill (`onStart`/`onDrained`/dependency-aware `load`), rate limiting, lane take
  algorithms, presence-driven durability, three-tier full-capture store, handle error inference.
- Daemon: execution store integration, live event streams, remote-proof events, typed control
  verbs (`wake`, `resetCadence`).
- Polling namespace: `spaced`/`jittered`/`backoff`/`accelerating`/`dynamic`/`adaptive`/`cron`
  presets plus `wakeOn(stream)`; internal tag with `Polling.layer`/`Polling.current`.

### Stores, logs, storage

- `Store.Storage` public API (`layerDefaultMemory`, `withDefault`, `withStorage`); store
  transforms (`mapEffects`, `catchWriteErrors` + `StoreWriteError`); journal codecs via
  `Schema.toCodecJson`.
- Durable `HostLogs` by host/resource with cursors; `LogContext` lineage; SQLite and Redis
  runtime storage (Prisma removed).

### Observability and UI

- Custom metrics served from the Metric registry; per-type dashboard widgets (browser + Ink TUI
  over one data layer); `/cli`, `/tui`, `/web` subpath exports.
- **Web dashboard naming:** `RunTag` / `isRunTag` / `useRunBundle` / `runBundle` →
  `GateTag` / `isGateTag` / `useGateBundle` / `gateBundle`; `processLeaves` → `daemonLeaves`;
  `CustomQueue*` / `useCustomQueueBundle` / `isCustomQueueTag` / `customQueueBundle` →
  `Priority*` / `usePriorityBundle` / `isPriorityTag` / `priorityBundle` (matches
  `WorkPool.priority`).

### Docs

- Documentation site (hyperlink.cool): compiler-accurate API reference with type-on-hover
  previews and in-code API links, full-text search, llms.txt, releases page, standards corpus —
  with every code sample typechecked against this release's source.

## 0.8.0-beta.28

### Minor Changes

- **Queue durability is now presence-driven — the `persist` config field is removed (breaking).** A queue becomes
  durable when a `DurableQueueStore` layer is in context (with an `itemSchema` so the payload serializes) —
  providing the layer is the switch. An in-memory "durable" store is a contradiction, so durability is
  intentionally not a baked-in default; absence of the layer is the normal ephemeral in-memory queue. Removed the
  `persist` field on `QueueResourceConfig` and the `QueuePersistOptions` type. Migration: delete `persist: true`
  and provide the `DurableQueueStore` layer; `persist: { maxAttempts: n }` → set the queue's `attempts` (the
  dead-letter budget derives to `attempts + 1`); lease/poll use engine defaults for now; to keep one queue
  ephemeral while others are durable, scope the layer so that queue does not receive it.

- **Add shape-first `Store` contract API with EventJournal-backed persistence.** New `@nikscripts/effect-pm/Store`
  surface: `Store.contract` / `Store.shape` (part 1 shapes + optional part 2 custom methods), `Store.Service` /
  `Store.Tag` aggregates with `at(tag)` lookup, standalone `Store.store`, `Resource.store` tag attachment, and
  built-in `QueueResource.store` / `Process.store` facet registrations. Handles are fully typed
  (`store.<shape>.append` / `.read`, flat aliases). `layerMemory` uses `EventJournal.layerMemory`;
  `layer({ filename })` persists via `SqliteClient` + `SqlEventJournal`. `Store.changes` streams append events;
  `Store.retention(maxRows)` trims oldest rows per scope. The built-in `QueueResource.store` persists the same
  `QueueEvent` union the live `.events` stream carries (one event model for wire + persistence). Platform log
  facets remain future work.

## 0.8.0-beta.27

### Minor Changes

- 36b4190: **Flat module namespaces for the remaining Tag/service modules (breaking).** Continues the object-literal →
  module-namespace conversion started in beta.9 (`Resource`, `Group`, `QueueResource`): the module now **is** the
  namespace (`import * as Name`), members are flat top-level exports, and partial imports tree-shake.

  Now converted: **`Logs`**, **`Query`**, **`LogContext`**, **`LogEntry`**, **`NodeLogs`**, **`RunResource`**,
  **`HttpApiResource`**, **`HttpClientGate`**, **`ResourceConfigure`**, and **`ProcessStorage`**. All documented
  members are preserved — the flat root re-exports (`And`, `captureLoggerLayer`, `LogAnnotationKeys`, `acceptJson`,
  `configureLayer`, …) and the namespace members (`Query.And`, `Logs.captureLoggerLayer`, `LogEntry.Schema`,
  `NodeLogs.layer`, `RunResource.Tag`, `HttpApiResource.Service`, `ResourceConfigure.tagKey`, …) are the same
  bindings. `RunResource.Tag` / `HttpApiResource` now tree-shake their gate/runner and client-builder engines out
  of a partial import. `ProcessStorage`'s `layer` / `layerRuntimeStorage`, the facet aliases (`ProcessStorage.Log`
  / `.QueueResource` / …), and `ProcessStorage.Services` (now a flat `type`) convert likewise.

  Internally, `QueueResource` and `CustomQueueResource` moved their engines under `src/internal/` so the public
  subpaths carry only the tree-shakeable contract `Tag` (no public-surface change — the subpaths already resolved
  to the namespace since beta.9).

  **Migration.** Direct subpath **value** imports of the converted namespace objects change form:
  `import { NodeLogs } from ".../NodeLogs"` → `import * as NodeLogs from ".../NodeLogs"` (and likewise
  `ProcessStorage`, `RunResource`, `HttpApiResource`, `HttpClientGate`, `ResourceConfigure`, `Logs`, `Query`,
  `LogContext`, `LogEntry`). The barrel forms (`import { NodeLogs } from "@nikscripts/effect-pm"`, …) are
  unchanged.

- 29259ee: `Process` is now a single Effect **module namespace** (`export * as Process`) that carries both the supervisor engine and the location-transparent `Resource` toolkit — the same shape as `QueueResource`. Member access tree-shakes: a `Process.Tag`-only consumer pulls no engine code; `make` / `layer` / `serve` pull the engine only when referenced.

  **New (Resource toolkit, additive):**

  - **`Process.Tag`** — define a managed process as a toolkit resource (observation + lifecycle: `status` reactive ref, `start` / `stop` / `runImmediately`, `logs.live` / `logs.history`). Driven locally or remotely over RPC through the same `yield* Tag` surface.
  - **`Process.schedule(...)`** (pipeable) — attach a schedule. Inline windows (`Process.schedule([Process.window(...)])`) give the process its own `schedule` verb group (`entries` / `set` / `add` / `clear`); an external `Process.Schedule` resource gates it with no added verbs.
  - **`Process.result(Schema)`** (pipeable) — mark a process value-returning; it gains a reactive `result` holding the latest success (an `Option`, absent until the first run).
  - **`Process.Schedule`** — a standalone, reusable, RPC-capable window manager (full CRUD) that can gate one or more processes.
  - **`Process.window` / `Process.at`** — declarative schedule-window templates (id optional).
  - **`Process.layer` / `Process.serve` / `Process.serveRemote` / `Process.configure`** — run a process resource locally, serve it (with/without the local instance), or fold a per-environment config patch. **`Process.scheduleLayer` / `Process.scheduleServe`** do the same for a standalone `Process.Schedule`.

  **Compatibility:** the engine surface is unchanged and stays under the same namespace — `Process.make`, `Process.Service`, `Process.currentScheduleId`, `Process.scheduleControls`, `Process.Errors` all keep working (barrel and `import * as Process` usage is unaffected). The only behavioral change is the export mechanism: a named-value import of the old namespace object (`import { Process } from "@nikscripts/effect-pm/Process"`) must become `import * as Process from "@nikscripts/effect-pm/Process"`.

- 7a1a1d4: **Retire `ScheduledProcess` and privatize the schedule primitive (breaking).** The managed-process
  surface is now a single module: **`Process`** carries both the toolkit contract (`Process.Tag`) and
  the engine (`Process.make`), the same shape as `QueueResource`. `ScheduledProcess` and the public
  `ProcessSchedule` primitive are gone; everything they offered lives on the `Process` namespace.

  **Removed**

  - **`ScheduledProcess`** — the namespace **and** the `@nikscripts/effect-pm/ScheduledProcess`
    subpath. Define a process with **`Process.Tag`** and run it with **`Process.layer`** /
    **`Process.serve`** / **`Process.serveRemote`** / **`Process.configure`** (the engine
    `Process.make` / `Process.Service` are unchanged).
  - **Public `ProcessSchedule`** — the schedule primitive is now internal. Its constructors, window
    builders, types, and the standalone schedule resource are re-exposed on the `Process` namespace.

  **Migration**

  | Old                                                                                               | New                                                                                                                  |
  | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
  | `ScheduledProcess.Tag` / `layer` / `serve` / `serveRemote` / `configure`                          | `Process.Tag` / `Process.layer` / `Process.serve` / `Process.serveRemote` / `Process.configure`                      |
  | `import … from "@nikscripts/effect-pm/ScheduledProcess"`                                          | `import * as Process from "@nikscripts/effect-pm/Process"`                                                           |
  | `ProcessSchedule.inMemory(entries?)`                                                              | `Process.scheduleInMemory(entries?)`                                                                                 |
  | `ProcessSchedule.empty`                                                                           | `Process.scheduleInMemory()`                                                                                         |
  | `ProcessSchedule.alwaysArmed`                                                                     | _(the default — omit `schedule` / `scheduleLayer`)_                                                                  |
  | `ProcessSchedule.define(build)`                                                                   | `Process.scheduleDefine(build)`                                                                                      |
  | `ProcessSchedule.at(...)` / `ProcessSchedule.window(...)`                                         | `Process.at(...)` / `Process.window(...)`                                                                            |
  | `ProcessSchedule.fromStarts(dates)`                                                               | `dates.map((d) => Process.at(d))`                                                                                    |
  | `ProcessScheduleEntry` / `ProcessScheduleService` / `ReconcileResult` / `ProcessScheduleControls` | `Process.ScheduleEntry` / `Process.ScheduleService` / `Process.ScheduleReconcileResult` / `Process.ScheduleControls` |

  Prefer the pipeable combinator when a process owns its windows —
  `Process.Tag<T>()("id").pipe(Process.schedule([Process.window(start, stop)]))` — or gate one or more
  processes with a standalone **`Process.Schedule`** resource. Reading process status is now the
  reactive `status` ref (`status.get` / `status.changes`), matching the queue.

- 4b199c6: **Replace `value` fields with `ref` (a `Subscribable`).** A `value` was a plain property kept "live" by a
  background fiber mutating the service object in place — which Effect never does (a plain member is fixed at
  construction; changing state is a `Ref` read through an effect). With `constant` already covering the
  fixed-at-build case, `value` was a non-idiomatic hack between the two.

  - **Dropped `value`.** Field kinds are now `constant` / `ref` / `effect` / `stream` / `local` / `fleet`.
  - **New `Resource.ref(schema)`** → materializes as **`Subscribable<A>`** (`{ get: Effect<A>; changes:
Stream<A> }`), uniform local and remote: `yield* svc.x.get` for the current value, `svc.x.changes` to
    observe. The impl owns a `SubscriptionRef`, provided via **`Resource.subscribable(ref)`** (or
    **`Resource.mapSubscribable(source, f)`** to derive one — e.g. a queue's `size` from its `status`).
  - **Removed `Resource.changes` / `Resource.ref` accessors** — `ref` fields expose `.changes` natively.
  - **Deleted the mirror machinery** (`bindValueToProp`, the 30s block-for-initial and its deadlock class).

  **Migration:** `Resource.value(S)` → `Resource.ref(S)`; the impl gives a `Subscribable` (`subscribable(ref)`
  or `mapSubscribable`) instead of a raw `Stream`; reads become `yield* svc.x.get` (was `svc.x`) and
  `svc.x.changes` (was `Resource.changes(svc, s => s.x)`). Queue `size`/`status`/`isEmpty` are now `ref`s.

  **Serve-family vocabulary (breaking).** Modes are now protocol-neutral and uniform across `Resource` and
  every contract namespace (`QueueResource`, `CustomQueueResource`, `Process`, `ApiMetrics`,
  `Telemetry`):

  - **`layer(tag, impl)`** — local only (grants `Self | LocalCapability<Self>`).
  - **`serve(tag, impl)`** — local **and** served, the default. Builds the impl **once** and grants
    `Self | LocalCapability<Self>` alongside the wire handlers, so a co-located node serves its resources
    **and** `yield*`s them (read a `local` member, share a `ref` cell) with no double materialization and no
    second `peersLayer`.
  - **`serveRemote(tag, impl)`** — served only (a pure gateway/edge; no local grant).
  - **`client(node)`** — remote.

  **Transport bundlers:** **`httpServer([...serve-layers], opts)`** exposes one or more `serve`/`serveRemote`
  layers on a single http `RpcServer` (and auto-serves the reserved node-status resource, so it fully replaces
  the old all-in-one entry point); **`httpClient(node)`** wires a node's transport from a `url`; generic
  **`connect`** covers custom protocols.

  **Removed** the transitional names: `server`, `serverEntry`, `remoteEntry`, `serveHttp`, `serveAllHttp`, and
  the `ServeEntry` `{ tag, impl }` shape. Migrate `serverEntry`→`serve`, `remoteEntry`→`serveRemote`,
  `serveHttp(X, i, opts?)`→`httpServer([serve(X, i)], opts)`, and
  `serveAllHttp([...])`→`httpServer([...serve-layers])`.

## 0.8.0-beta.26

### Patch Changes

- **Fix broken beta.25 build.** The `Host`→`Node` rename moved `MultiHost.ts`→`MultiNode.ts`, but the root
  `tsup.config.ts` entry and the `./MultiHost` package export still pointed at the deleted file, so `tsup`
  failed with `Cannot find MultiHost`. Repointed both to `MultiNode` (subpath is now
  `@nikscripts/effect-pm/MultiNode`). No source changes.

## 0.8.0-beta.25

### Minor Changes

- **Rename `Host` → `Node` (breaking).** "Host" implied a machine; a fleet member is a per-process runtime,
  so `Node` is accurate (and avoids clashing with Effect's `HttpApiEndpoint`). Migration:

  - `Resource.Host`→`Resource.Node`; `HostKey`→`NodeKey`, `AnyHost`→`AnyNode`, `HostBoundTag`→`NodeBoundTag`,
    `SelfHostId`→`SelfNodeId`, `HostRef`→`NodeRef`; `hostOf`→`nodeOf`, `selfHost`→`selfNode`.
  - Tag option `{ host }`→`{ node }`; `Resource.multiHost([…])`→`Resource.distributed([…])`;
    `peersLayer(…, { hosts })`→`{ nodes }`.
  - Subpaths `/HostStatus`→`/NodeStatus`, `/HostLogs`→`/NodeLogs`; barrel `HostStatus`/`HostLogs`
    namespaces likewise. ApiMetrics `ApiMetricsHostTag`→`ApiMetricsNodeTag`.
  - **Wire-visible** (both ends must upgrade together): reserved `kind` strings (`…/HostStatus`→`…/NodeStatus`)
    and the structured-log annotation key (`host`→`node`).

- **`./ScheduledProcess`** now resolves to its tree-shakeable namespace (schemas re-exported); **`ApiMetrics`**
  is flat `export * as ApiMetrics` (the `ApiMetricsModule` alias is removed).

## 0.8.0-beta.24

### Minor Changes

- fa4fae6: **`Resource.make` for reusable impls, and host-free multiHost resources.**

  - **`Resource.make(tag, impl)`** — anchor a **hoisted** implementation to its contract at the definition
    site. Inline impls (`layer` / `serverEntry` / `serve`) are already typed; extracting one to a `const`
    (to share across the local layer + a served entry, or several serves) loses that typing and surfaces the
    mistake far away at the serve call. `Resource.make` infers the tag's spec, constrains `impl` to its
    `ImplOf`, returns it typed. Overloaded for the `Effect`-form (`R`); runtime identity. Also exports
    **`SpecOf<T>`** for the `obj satisfies ImplOf<SpecOf<typeof Tag>>` route.
  - **Host-free multiHost.** `Resource.peersLayer(tag, self, { hosts })` takes the fleet **at the use site**,
    so a shared multiHost resource is defined host-free and exported (hosts are a deployment concern).
    Falls back to the tag's baked `.multiHost([…])` when omitted (backward-compatible).

## 0.8.0-beta.23

### Minor Changes

- bf1ba7a: **Live `value` fields in the queues + the accessors, a de-brand, a multiHost deadlock fix, and
  export-naming cleanup.**

  - **`Resource.changes(svc, (s) => s.a.b)` / `Resource.ref(svc, …)`** — subscribe to a `value` field's live
    delta stream (current value first, then every update), or grab its `SubscriptionRef`. A **selector**
    (nesting-friendly, full autocomplete), not a string path. `value` fields are now `SubscriptionRef`-backed;
    the plain read is unchanged.
  - **De-brand (Effect idiom).** Internal symbol brands → a string identity `TypeId` + readable **`_tag`**
    (`"constant"`/`"value"`) / **`fleet: true`**; spec types read as English, no `Symbol(…)` keys.
    **`.annotate()` now preserves the marker** (`value(x).annotate({…})` stays a value — was a silent degrade).
  - **`ImplOf<S>` exported** — the impl type (a `value`'s impl is its feeding `Stream`, a `constant`'s the
    `Effect<A>`), distinct from `ServiceOf`.
  - **Queues adopt `value` (BREAKING service shape).** `status` → live `value` (plain `p.status` **and**
    `changes`-subscribable); `statusNow`/`sizes`/`completed` removed (read `p.status.*`); `size`/`isEmpty` →
    `value`; `metrics`/`logs` → nested `{ live, history }`. Same for `CustomQueueResource` (`levelSizes` stays
    an `effect`).
  - **Fix (multiHost): peer clients are lazy** — a `value`/`stream` field no longer deadlocks the serve.
    `peersLayer` no longer eager-builds peer clients; a peer reads a `value` **one-shot** (`PeerServiceOf`'s
    `value` is `Effect<A>`, so `combineQuery(peers, (p) => p.n, …)` works like an `effect`), and unreachable
    peers are dropped. A `value`-bearing multiHost resource now boots against a down/co-booting peer.
  - **Export naming (BREAKING).** `./QueueResource` + `./CustomQueueResource` subpaths resolve to their full
    tree-shakeable namespaces; the confusing `./QueueContract` + `./CustomQueueContract` subpaths are removed
    (import from `*/Resource`). No code moved; the light-Tag/heavy-engine split is unchanged.
  - **Removed `ProcessScheduleResource`** (unapproved, unused). The `ProcessSchedule` primitive is untouched.

## 0.8.0-beta.22

### Minor Changes

- d201c0e: **Service-shape redesign — shape-named builders, `constant`/`value`, single-schema payloads,
  and nested specs.** Spec builders are named for **what they resolve to in the service**, not the RPC
  verb, the set expands beyond Effects, payloads match Effect's `Rpc.make`, and specs can nest.

  - **`Resource.effect`** (→ `Effect<A>`, was `query`) and **`Resource.effectFn`** (→ `(In) => Effect<A>`,
    was `mutate`) — shape-named vocabulary. **`query`/`mutate` are retired** (renamed toolkit-wide): update
    `Resource.query` → `Resource.effect`, `Resource.mutate` → `Resource.effectFn`. **(BREAKING)**
  - **`Resource.constant(S)`** — a value resolved **once at acquire**, surfaced as a **plain** property
    (`p.x: A`, no `yield*`), identical local and remote. **`Resource.value(S)`** — a plain property kept
    **live** by a background stream (impl supplies a `SubscriptionRef`'s `.changes`); acquire blocks for the
    initial value, then reads are free.
  - **`payload` accepts a single schema everywhere (Effect-aligned).** `effect`/`stream` previously took
    only loose struct **fields**; they now also take a single **schema** — a `Schema.Struct({…})`, a bare
    item, or a union (`item | item[]`) — exactly like `effectFn` and `Rpc.make`
    (`Schema.Top | Schema.Struct.Fields`). Both forms stay supported; prefer the schema form.
  - **Nested specs (spec-tree).** A spec can nest — groups of leaves — to any depth
    (`connections: { size: effect(Number), changes: stream(Number) }`); the tree flattens to **path-keyed**
    wire procedures (`"connections.size"`) and nests back in the service, so `p.connections.size` works
    identically **local and remote**. Leaves may be any builder.

## 0.8.0-beta.21

### Minor Changes

- 66a6be9: **New: `Telemetry` — a thin, custom, dashboard-native metrics surface.** Serves a host's whole
  Effect `Metric` registry as a `Resource` (`snapshot` query + `live` ~1s stream) for building custom
  in-app metrics UIs with no external infra — the counterpart to OTEL export (same source, different
  sink; OTEL stays doc-only via `@effect/opentelemetry`, no new dependency). `import * as Telemetry from
"@nikscripts/effect-pm/Telemetry"` → `Telemetry.Tag` / `layer` / `serverEntry` / `snapshotNow` + the
  `MetricsSnapshot` envelope (tagged counter/gauge/histogram). Host axis is free (which host you connected
  to); fan out with `Resource.client(tag, host)`. Cardinality-disciplined. See
  `docs/guides/telemetry.md`.

## 0.8.0-beta.20

### Patch Changes

- 537cc40: **Fix: `QueueResource.serve` now resolves.** The beta.19 engine-`serve` for queues was added to
  `QueueContract` but not re-exported through the `QueueResource` namespace, so `QueueResource.serve` (as
  written in the beta.19 changeset, example, and docs) didn't exist — only `QueueContract.serve` did,
  asymmetric with `ScheduledProcess.serve`. Re-exported `serve` through `QueueResource` so the two match
  and the docs are correct as written.

## 0.8.0-beta.19

### Minor Changes

- f423286: **Engine-aware `serve` — `QueueResource.serve` / `ScheduledProcess.serve`.** The beta.18
  `Resource.serve` is query-only (mounts RPC handlers, runs no engine), so it can't serve queue/process
  resources with isolated per-resource dependencies. These new forms are the engine-running counterparts:
  they run the worker / refill / `persist` (queues) or tick schedule (processes) engine, mount the RPC
  handlers, register into `Resource.servedResourcesLayer`, **and preserve the worker/tick requirement `R`**
  so a per-resource `Layer.provide` isolates it — composed under `Resource.httpServer` exactly like
  `Resource.serve`. Same shape as the existing `serveHttp`. `serveAllHttp` + `serverEntry` stay the
  shared-dependency tool.

- ac258d3: **Two ergonomic helpers.** `Resource.httpServer(serves, options?)` — pass the `serve` layers as
  the first argument and it bundles the `provideMerge` + `servedResourcesLayer` boilerplate (and removes
  the `provideMerge`-vs-`provide` footgun); the low-level `httpServer(options)` form is unchanged.
  `Resource.fleetHealth(tag, pick, own)` — the canned droplet-health fold: `pick` a leaf from every peer,
  key it **by host** (`Combine.byHost`), and add this host's `own` value keyed by `selfHost` — the
  recurring `combineQuery(peers, pick, Combine.byHost)` + `selfHost` pattern in one call. A down peer is
  skipped (captured, never thrown).

## 0.8.0-beta.18

### Minor Changes

- e747e52: **Per-resource dependencies at the serve — `Resource.serve` / `Resource.httpServer`.** When
  resources on one host need **different implementations of the same dependency tag** (mutually exclusive
  — e.g. a hook-firing handler for one, a plain one for another), `serveAllHttp`'s single unioned provide
  can't tell them apart. The new primitives give each resource **its own** `Layer.provide`, isolated, on
  one shared `/rpc`:

  - `Resource.serve(tag, impl)` — a handler layer that **preserves** the handlers' requirement `R` (via
    `ServeRequirements<Impl>`), so a per-resource `Layer.provide` discharges it. Self-registers for
    `/health`.
  - `Resource.httpServer(options?)` — reads the served-resources registry, merges every group onto one
    `RpcServer` (`/rpc`), and mounts a `/health` route. `provideMerge` the `serve` layers onto it.
  - `Resource.servedResourcesLayer` / `Resource.ServedResources` — the registry `serve` writes and
    `httpServer` reads.
  - `Resource.provide(dependency, [resources])` — sugar for
    `Layer.mergeAll(resources).pipe(Layer.provide(dependency))`.

  Dependencies compose via ordinary `Layer.provide` (no config-embedded layer, no branding); sharing is
  by memoization (same value → one instance, `Layer.fresh` to isolate). Tick/worker bodies just declare
  their requirement — no `Effect.provide`, so consumers can run `strictEffectProvide: "error"`.
  `serveAllHttp` is unchanged and stays the tool for the shared-dependency case. New public types:
  `ServeMethod`, `ServeImplOf`, `ServeRequirements`, `ServedResource`. Guide:
  `docs/guides/per-resource-dependencies.md`; dogfooded in `examples/serve-per-resource-deps.ts`.

## 0.8.0-beta.17

### Minor Changes

- 0ab917e: **Durable log storage, queryable by host or by resource.** `HostLogs.persistLayer(host)`
  installs a batched capture logger that durably stores every runtime log line in `LogStore` — bucketed
  by host, with each line's `processId` / `queueId` preserved — backed by `RuntimeStorage` (memory /
  sqlite / redis via `ProcessStorage`). Read it back with `HostLogs.byHost(host, opts?)` (every line a
  host logged) or `HostLogs.byResource({ processId?, queueId? }, opts?)` (a specific queue/process,
  across hosts); both return `[]` (not an error) when empty, newest first. The logger is installed at
  layer-build so it captures from the start (no relay-subscription race). **Removes** the stranded
  process-group log paths: `ProcessGroupLogContext` / `layerProcessGroupLogContext` and the flat
  `HostLogs.history` / `HistoryStore`-bucket persistence are gone; `LogAnnotationKeys` gains `host`
  (drops `groupId`), adds `withHostLogAnnotations`.

- 1c7ebef: **`Resource.client(tag, host)` — read a hostless multi-host tag as a client.** A hostless
  `multiHost` tag is N instances, so the client names which one:
  `Resource.client(FleetDatabase, NwslHost).pipe(Layer.provide(connectHttp(NwslHost)))`. The transport
  resolves from that host, so the layer requires it (satisfied by `connectHttp`) — enforced at compile
  time. Turns the previous runtime `Service not found: RpcClient/Protocol` (a hostless client wired to a
  host service) into a type error. Host-bound tags unchanged (`Resource.client(tag)`).

- 28f3769: **`Resource.selfHost(tag)` — the host key a multi-host instance runs as**, the same key its
  `Resource.peers` are keyed by. For `Combine.byHost` folds (one row per host), so a resource keys its
  own row without hand-threading: `return { ...byHost, [self]: ownValue }`. Provided by `peersLayer`
  (now bundled) or standalone `Resource.selfHostLayer(tag, self)`.

- cd8a472: **`Resource.peersLayer(tag, self, { url })` — override peer urls** without freezing them into
  the host contract. `Host.url` stays the default; the resolver `url: (host) => Effect<string |
undefined>` overrides per host (env ports, tunnels, Effect `Config`), falling back to `Host.url`. Its
  error + requirements flow to the layer (typed) — a `ConfigError` is a typed layer-build failure, or
  return `undefined` to skip a peer. Fully back-compatible (omit `options`).

## 0.8.0-beta.16

### Minor Changes

- 85336ae: **Multi-host resources via `Resource.peers`.** One resource shape served as N host-local
  instances (one per host). Combined/fleet values are plain queries tagged `Resource.fleet` and
  implemented in the layer by folding `Resource.peers` (the other hosts' leaf clients) + your own value
  — no special field kind. New surface: `Resource.Host("id", { url })` (the host carries its url),
  `.pipe(Resource.multiHost([hosts]))` (the fleet — hostless, every instance an equal peer),
  `Resource.peers` / `peersLayer` / `peersFrom` (the opt-in mesh), and `Resource.fleet` / `FleetField`
  (a combined field: served + client-visible, but **excluded from `peers`** so a fold can't fan out).
  `Resource.layer` / `Resource.serverEntry` gain an **`Effect` form** (build the impl effectfully — e.g.
  resolve `peers` once). `Method` is now `Pipeable`.

- dfa8dd2: **`@nikscripts/effect-pm/MultiHost`** — the isomorphic combine core (browser + node):
  `combineQuery` / `combineStream` gather a field across a keyed peer map, capturing each host's outcome
  (`HostResult`), then fold; `Combine` ships `sum` / `collect` / `byHost` / `successes` / `failures` /
  `mergeStreams` / `mergeByHost`. A custom fold sees every outcome and owns the down-host policy.

### Patch Changes

- 26c7c41: **Upgrade Effect to `4.0.0-beta.92`** (from `beta.69`) — `effect` (peer + dev),
  `@effect/platform-node`, `@effect/sql-sqlite-node`, `@effect/vitest` in lockstep. No source changes
  needed. Consumers should move to `effect@^4.0.0-beta.92`.

## 0.8.0-beta.15

### Minor Changes

- f21e20e: **`Resource.serverEntry(tag, impl)`** — a typed `serveAllHttp` entry for a raw custom
  resource (mirrors the contract `serverEntry`s). The impl is **spec-checked** against the tag's spec,
  unlike a bare `{ tag, impl }` literal (typed `Record<string, unknown>`). Two forms: a record
  (`R = never`) or an `Effect` that builds it carrying a requirement `R`. `Resource.instance` (for the
  `serveInstances` family) now points here.

- 1a13471: **`serveAllHttp` unions each entry's requirement `R`** instead of pinning all to one — a host
  serving queues/processes (worker `R`) next to `ApiMetrics` (`Scope`) and plain resources (`never`)
  no longer needs `as ServeEntry<never>` per entry. Bare `{ tag, impl }` literals contribute nothing
  rather than poisoning the union.

- dfb27f2: **Removed the Prisma storage backend (BREAKING).** `@nikscripts/effect-pm/storage/prisma`
  and `…/prisma`, `PrismaRuntimeStorage`, the structural client types, the `effect-pm` prisma CLI
  helpers, and the `@prisma/client` optional peer are gone — an unused, codegen-heavy backend already
  covered by the **sqlite** and **redis** backends. (Recoverable from git.)

### Patch Changes

- 5e6b954: **`Resource.withReadiness` data-first accepts a host-bound class** (a `typeof X` constructor),
  via inferred overloads (host preserved in the return), the way `client`/`layer` do. Resource group
  types stay fully precise (`RpcGroupOf<S>`) — no erasure, no cast.

## 0.8.0-beta.14

### Minor Changes

- 606dbbc: **Full-screen health board.** Tapping the host-status die opens a full-screen board over
  every host's `HostStatus.resources[]`: a stat strip (hosts ok · resources ready · attention count),
  a "needs attention" list of degraded resources across all hosts with their root cause (tap → that
  resource), and a card per host (status · uptime · ready/total · resource count · a "ready over time"
  sparkline) with its resource roster. Clean overlay navigation (resource → host → board → dashboard).
  New `/web` export `HealthBoard`; the die now just opens it.

- f844488: **Readiness on resource detail pages.** A resource's page shows an amber
  `degraded — <root cause>` banner under its header when it isn't ready (read from its host's
  `HostStatus` — the SSOT the board uses, via new `data.resourceHostRef`). It renders nothing while
  ready/connecting, so it only takes space on a problem. New `/web` export `ResourceReadinessBanner`.

### Patch Changes

- 4d367ea: Host metrics: each health-board host card shows a client-accumulated **readiness
  sparkline** (ready-count over time) that dips when a resource degrades — no server change.

- 871b71e: The resource-page readiness banner is hidden while ready (only appears on a degraded
  resource), so it doesn't push content down in the normal case.

- bf83f20: **`withReadiness` accepts host-bound tags on both overloads.** The host-bound fix (a
  `HostBoundTag` isn't assignable to a bare `ResourceTag<any, any>` — invariant `[groupSym]`) now
  covers the data-first `Resource.withReadiness(tag, fn)` overload too, not just data-last `.pipe`.
  (The supported way to attach readiness to a host-bound tag remains the data-last `.pipe` form.)

## 0.8.0-beta.13

### Minor Changes

- e1bf860: **Hosts in the dashboard.** `Resource.hostOf(tag)` reads a tag's bound `Resource.Host`, so
  the web dashboard derives its host list from the `Group` tree (no registry). A host-status **die**
  in the header shows one pip per host (coloured by its `HostStatus`, barrel-stacked, larger when
  fewer); tap it for a hosts panel, tap a host for its full screen (per-resource readiness + live
  logs), tap a resource to open its detail (back returns to the host). Header polished (screen-centered
  title, negative-space resource count). New `/web`: `HostBar`, `HostDetail`, `HostDots`,
  `hostStatusBundle`, `useHostBundle`, `leafByKey`; debug console gained icon + copy buttons. The
  `resource-web` example is now a real remote dashboard (three hosts over `serveAllHttp`).

- 9ae6c42: **ApiMetrics serves on a host (BREAKING).** `ApiMetrics` is now a per-instance resource
  with its own RPC group, so it composes into `serveAllHttp` like a queue/process. New
  `ApiMetrics.Tag<Self>()(clientId, { host?, description? })` (host-bearing returns `ApiMetricsHostTag`)
  and `ApiMetrics.serverEntry(tag)` (fed from the Metric registry); host-bound keys are host-prefixed
  so the same `clientId` on two hosts doesn't collide. Removed `serveInstances` / `clientInstances` /
  `instance`; `layer` / `layerFor` unchanged.

- a5a4b3c: **Dependency-aware readiness.** `withReadiness` derivations receive the prior readiness as
  `base` and **stack** (extend a factory's check instead of replacing it); `Resource.readinessOf(tag)`
  pulls a resource's readiness by tag (compile-time-checked dependency, local or remote);
  `Resource.allReady([...])` ANDs checks. So a queue/process can report degraded when a dependency
  (e.g. a database resource) is down.

### Patch Changes

- ad91f49: **Host-bearing tags can be `export`ed** — the host-bearing constructors return a named
  `Resource.HostBoundTag` (and `ApiMetricsHostTag`) instead of an inline intersection, fixing TS4020
  ("uses private name `hostSym`") when a consumer exports a host-bound tag.

## 0.8.0-beta.12

### Minor Changes

- fa8762c: **Unified tag construction shape (BREAKING).** Service tags now all follow the Effect
  `Context.Service` idiom — `Tag<Self>()(identity, …, options?)`. `Resource.Tag<Self>(key)(spec)`
  becomes `Resource.Tag<Self>()(key, spec, options?)` (and `host` moves from a positional arg into
  `options.host`); `ApiMetrics.Tag<Self>(clientId)()` becomes `ApiMetrics.Tag<Self>()(clientId)`.
  The queue / scheduled-process / custom-queue / process-schedule / run factories already used this
  shape and are unchanged, as is `Resource.tagFor`. No back-compat / deprecation (beta).

- 765d195: **Per-resource readiness → `/health` 503 + `HostStatus` board.** Every resource can report
  whether it's working, derived from its own status (SSOT). `Resource.withReadiness` is a dual
  combinator (`withReadiness(tag, fn)` or `tag.pipe(withReadiness(fn))`) that attaches a derivation
  `(svc) => Effect<{ ready, detail? }>`; the built-in contracts apply it (queue/custom-queue ready
  iff the worker pool is `running`, scheduled-process iff `supervising`), a bare `Resource.Tag` opts
  in the same way, and a tag without one is ready by default. `serveAllHttp` aggregates once: the
  always-on **`GET /health`** route returns `200`/`503` (`status: "ok" | "degraded"`) with a body
  listing each resource's `{ key, kind, ready, detail? }`, and **`HostStatus`** folds the same
  aggregate into its schema (`status` + `resources[]`, plus `HostStatus.resourceReadiness`). Restores
  the readiness endpoint the removed control plane used to provide.

## 0.8.0-beta.11

### Minor Changes

- ace74b5: **Tags now carry their contract kind.** Each contract's `.Tag` factory stamps a canonical
  `kind` id on the tag (e.g. `@nikscripts/effect-pm/QueueResource`), read with **`Resource.kindOf(tag)`**
  — so consumers (notably the web/TUI dashboards) classify a tag by what it _is_ instead of sniffing
  its spec members (which mis-classified `ApiMetrics` as a process and broke custom-queue /
  process-schedule tags). Each contract exports its `kind` (`QueueResource.kind`,
  `ScheduledProcess.kind`, `ApiMetrics.kind`, `CustomQueueResource.kind`,
  `ProcessScheduleResource.kind`); `makeTag` / `tagFor` accept a `kind` option.

- 6f7039b: **Host status — every served host auto-exposes its status + logs.** New
  `@nikscripts/effect-pm/HostStatus`: a reserved, hostless resource (`status` stream, `statusNow`,
  `ping`, `logs` stream, `logHistory`) that `Resource.serveAllHttp` now serves automatically
  alongside your resources — the host author wires nothing. Query any host with
  `HostStatus.clientHttp(url)` (or any `RpcClient.Protocol` for `Resource.client(HostStatus.Tag)`).
  Status reports `{ up, startedAt, uptimeMillis, resourceCount }`; logs/history come from the
  runtime-wide `HostLogs` relay when provided.

- 21418f0: **`@nikscripts/effect-pm/web` — API-resource dashboard widget** for `ApiMetrics` taps.
  A read-only per-type widget: `ApiCard` (a reusable iOS-style **`PagedCard`** — throughput
  sparkline + error-rate health badge, and a busiest-endpoints face), `ApiStats`, `ApiMetricChart`
  (throughput / errors / in-flight with the shared time-window toggle), and `ApiEndpointTable`
  (group / endpoint / requests / errors / avg in a sortable **TanStack** table). The dashboard
  classifies `ApiMetrics` leaves via the stamped kind and renders an `ApiDetail`; exposes
  `apiBundle` / `useApiBundle`. Also this cycle: a fullscreen **weekly schedule** editor for
  scheduled processes, chart **time-window** control, group-view names from member keys, and the
  shipped `theme.css` now carries `.safe-area` + view-transition CSS. Uses the optional peer
  `@tanstack/react-table` (alongside the existing `recharts`).

## 0.8.0-beta.10

### Minor Changes

- 70146c5: **`ApiMetrics` observability resource + `HttpApiResource.Service`.** `ApiMetrics` (a
  `Resource.tagFor` factory) links to an `HttpApiResource.Service` by `clientId` and exposes a
  windowed `metrics` stream and a `usageNow` query (requests, errors, throughput, per-endpoint
  breakdown). `HttpApiResource.Service` is a class factory for a typed API client with endpoint
  usage metrics and registry hooks. New subpaths: `@nikscripts/effect-pm/ApiMetrics`,
  `@nikscripts/effect-pm/ApiUsageSchema`, `@nikscripts/effect-pm/HttpApiResource`.

- 4954957: **Rename resource/service tag identity from `id` to `key`** across the toolkit. Tag
  factories take `key` as the first argument, tags expose Effect's `.key` (not a custom `.id`),
  `ResourceInstance` and `DuplicateResourceKey` use `key`, the UI bindings (`ResourceUI.key`) and
  the web dashboard follow the same naming, and multi-instance RPC routing dispatches on the HTTP
  `key` header. **BREAKING:** read `tag.key` instead of `tag.id`; pass `key` as the first factory
  argument.

- 461faa0: **Pluggable queue lane take algorithm** on `QueueResource` — schedule how lanes are
  drained without changing the public enqueue API. Adds `levelCount` and `takeAlgorithm` to
  `QueueResource` / `Service.configure` (`"priority"` default), built-in `"weighted"` and
  `"strict-descending"`, a custom `CustomTakeAlgorithm` hook, and a numeric `LaneStore` seam +
  `buildQueueEngine` extension point. The default bundle is unchanged — scheduled algorithms load
  via dynamic import only when configured.

- caf7e4d: **`CustomQueueResource` + `CustomQueueContract`** for N-level queues with named lanes,
  `add(item, level?)`, and `Record<string, number>` sizes. Adds `Resource.mutatePair` for
  two-argument wire methods. Subpaths: `@nikscripts/effect-pm/CustomQueueResource`,
  `@nikscripts/effect-pm/CustomQueueContract`.

### Patch Changes

- b702291: `@nikscripts/effect-pm/web`: the dashboard now owns its font. It previously relied on a
  global `body { font-family: var(--font-mono) }` plus inheritance, so a consumer rule on an
  intermediate element (e.g. an `#root { font-family: … }` in their `index.html`, ID specificity)
  overrode it and the dashboard rendered in the host app's font. `font-mono` is now declared on the
  dashboard's own root, so the widgets render monospace regardless of the host's `body`/`#root`
  font, while still honouring a consumer-defined `--font-mono` token.

- 0ce4ba4: `@nikscripts/effect-pm/web` dashboard polish: process controls stay a horizontal row at
  every width (only the queue controls go vertical, to flank the metric chart); card content stays
  top-aligned when the grid stretches a card to the row height (instead of a bare `<button>` centring
  its content in the slack); tighter log columns (time and level); and the metric chart gains a
  second dropdown to pick the latency series' time unit (ms/s/min/hr). The group view now labels
  cards and the breadcrumb by the **member key** under which each parent group holds them (the
  routing nickname — e.g. `Nwsl`/`Wnba`), not the last segment of the tag's own key; full-screen
  resource pages still use the tag's own key (a resource doesn't know its group-given nickname).
  `useGroupRoute` also returns the resolved `keys` (the member-key chain mirroring the path).

## 0.8.0-beta.9

### Minor Changes

- 22bb124: **Tag APIs are now uniform, tree-shakeable module namespaces** (Effect-style) — `import * as X`,
  no object literals. `Resource` and `Group` were object exports (so `import * as` / tree-shaking
  couldn't work); they're now per-member namespaces. The `/QueueResource` subpath previously
  resolved to the internal engine (an object whose `Tag` had **no `host`** and didn't tree-shake)
  — it now resolves to the namespace, so `import * as QueueResource from ".../QueueResource"` gives
  the **host-ful** `Tag` and `QueueResource.Tag` tree-shakes (~207 KB → ~27 KB). Bare `queueTag` /
  `processTag` are removed.

  **BREAKING.** Migrate: `import { Resource }` → `import * as Resource`; `import { QueueResource }`
  → `import * as QueueResource`; `queueTag<T>()(…)` → `QueueResource.Tag<T>()(…)`;
  `processTag<T>()(…)` → `ScheduledProcess.Tag<T>()(…)`.

### Patch Changes

- 0d6d602: `@nikscripts/effect-pm/web`: log timestamps use a compact 24-hour clock (`HH:MM:SS`,
  no AM/PM) with no-wrap + tabular figures, so the time column no longer wraps. Applied to the log
  stream and the debug console.

## 0.8.0-beta.8

### Minor Changes

- bcbafc3: `@nikscripts/effect-pm/web` now **ships the real dashboard** — the hand-crafted,
  per-type UI (previously trapped in the example), not the old generic introspection view.
  **`<Dashboard runtime={Atom.runtime(layer)} group={ServicesHub} />`** renders the responsive
  drill-down (queue / process / subgroup cards → styled detail with stats + edge-to-edge metric
  chart + icon controls + logs → routed fullscreen log viewer at `/Group/Resource/logs`),
  URL-backed navigation with view-transition animations, and locked-by-default controls with a
  confirm dialog on destructive actions. Compose the pieces (`DashboardView` + the widgets +
  `queueBundle`/`processBundle`/`useQueueBundle`/`useProcessBundle`) under `RegistryProvider` +
  `RuntimeProvider` + `ViewTransitionProvider`. Runtime-injected, browser-safe (no node deps);
  the example dashboard now consumes `/web` directly. **BREAKING:** the old generic exports are
  removed — `GroupView`, `ResourceView`/`ResourceWidget`/`useResourceUI`, `panels`, `primitives`,
  `binding`, `chart`.

- b5f9383: `@nikscripts/effect-pm/web`: add **`useGroupRoute(root)`** — URL routing that mirrors
  the `Group` tree (`/Wnba/ImportSchedule`, case-insensitive, History API back/forward + deep
  links). A selected leaf can carry a sub-view segment (`/Mail/logs` ⇒ `route.view === "logs"`)
  for per-resource pages like the fullscreen log viewer.

## 0.8.0-beta.7

### Minor Changes

- 2999895: `Resource.serveAllHttp` + `QueueResource.serverEntry` / `ScheduledProcess.serverEntry` — serve a
  whole group of resources on one HTTP port behind one `Host` (procedures group-id-prefixed). A host
  can now be a group on one port, not one-resource-per-port; one `Resource.connectHttp` transport
  reaches them all.

- b0a3249: Ship **`@nikscripts/effect-pm/cli`** — build a run-and-exit CLI from your resource tags.
  `makeResourceCli(resources, rootName)` (record of tags → `effect/unstable/cli` command tree; verbs +
  flags + help from the contract; `ls`), `resourcesByName(tags)` (shortest-unique-slash-suffix naming),
  `render(value)`.

- 615cbb1: Ship **`@nikscripts/effect-pm/tui`** + a shared UI core. The reactive React binding now lives
  once in `src/ui/atom-react` and is shared by web + tui (Ink is React); `/tui` adds composable terminal
  primitives (`bar`, `spark`, `compact`, `fmt`, `displayName`, `blankBorder`, `statusColor`/`statusIcon`).

- 3821c91: `@nikscripts/effect-pm/web`: View Transitions helpers — `ViewTransitionProvider`,
  `useViewTransition`, `useViewTransitionStyle` — animate navigation (a card morphs to fill the screen)
  with conditional naming, degrading to an instant update where unsupported.

### Patch Changes

- 8e2e611: `@nikscripts/effect-pm/web` reactive binding: `useAtomValue` mounts the atom (inside the
  subscription) and `useAtomSet` mounts its command atom, so cold stream atoms (status/metrics/logs)
  start on render instead of staying blank until an interaction.

- 3b4c822: Fix `QueueResource` refill dependency support: a refill `load` can require its **own**
  services, independent of the worker `effect` (separate `RR` requirement; `layer` / `server` /
  `serveHttp` / `serverEntry` surface the union `R | RR`). Runtime behavior unchanged.

- 0e6f5cb: Docs: add `docs/guides/setup.md` — a consumer setup guide (install + peer-dep matrix, the
  subpath map, and wiring a `serveAllHttp` server + `/cli` / `/tui` / `/web` against your tags).

## 0.8.0-beta.6

### Patch Changes

- ba9de58: Examples: a unified **`pm`** entrypoint that drives the same `Fleet` tags two ways — no
  subcommand launches the styled Ink dashboard; a subcommand runs a single command and exits
  (`pm Mail statusNow`, `pm Mail pause`, `pm KeyRotation start`, `pm ls`), over http via the shared
  data layer. Resource command names are the tag's display name, lengthened to the shortest unique
  slash-suffix only when two collide.

  Hardens the `makeResourceCli` example builder: an `ls` subcommand, stream/local methods filtered
  out by a precise contract guard (only wire query/mutate verbs become commands), and defensive flag
  derivation that skips `optionalKey`/date/duration fields and whole-`Schema` payloads instead of
  throwing.

## 0.8.0-beta.5

### Minor Changes

- 67ba214: Ship **`@nikscripts/effect-pm/web`** — a React widget library for building resource dashboards
  straight from the toolkit's `Tag`s. Queue and process cards, stat panels, metric charts, control
  buttons (with round-trip feedback) and live log streams, each driven by an atom bundle derived from
  a resource tag — no hand-rolled registry. A small Effect-atom binding (`effect/unstable/reactivity`)
  backs the same widgets in the browser and in an Ink TUI; the data layer is environment-aware, so the
  identical UI reads a local engine layer or a remote `Resource.client` over http without changes.

  Also adds the worked examples that exercise it: a tag-driven web dashboard (mobile + desktop) and a
  matching Ink TUI dashboard over the same shared data layer, plus a `pnpm run example:session` tmux
  launcher that boots the example servers and both UIs in one place.

## 0.8.0-beta.4

### Minor Changes

- 23d41bc: `QueueResource`: add a first-class **`refill`** config — a self-feeding queue that loads work from a
  source (DB, …) on start and/or whenever it drains empty. The toolkit replacement for the legacy
  `onStart` / `onDrained` lifecycle hooks:

  ```ts
  QueueResource.layer(RosterQueue, {
    effect,
    refill: {
      onStart: true, // bootstrap once when the worker pool starts
      onDrained: true, // re-poll the source each time the queue drains
      load: (queue) => loadFromDb(queue),
    },
  });
  ```

  `load` receives the queue handle, runs in the worker `R`, and is best-effort. `onStart` is forked
  (a slow source load doesn't block startup); `onDrained` runs after each `Drained` (drives the
  self-feeding loop, and idles when `load` enqueues nothing). Distinct from after-the-fact `events`
  observation — `refill` is a defining queue behavior (a pull source).

- 6323949: Rename the structured-logging symbols from the vestigial `ProcessManagerLog*` to neutral `Log*`
  (no behavior change) — the log infra never depended on the removed `ProcessManager`:

  - `ProcessManagerLogEntry` → `LogEntry`, `ProcessManagerLogEntrySchema` → `LogEntrySchema`,
    `ProcessManagerLogEntryNdjson` → `LogEntryNdjson`, `processManagerLogEntryFromLoggerOptions` →
    `logEntryFromLoggerOptions`
  - `ProcessManagerLogRelay` → `LogRelay` (+ `LogRelayService`), `ProcessManagerLogAnnotationKeys` →
    `LogAnnotationKeys`
  - `ProcessManagerLogQuery` → `LogQuery`, `ProcessManagerLogQueryError` → `LogQueryError`,
    `ProcessManagerLogSort` → `LogSort`, `ProcessManagerLogScope` → `LogScope`

  The `LogEntry` namespace (`LogEntry.Schema` / `encode` / `decode`) is unchanged; the renamed entry
  type now merges into it. Annotation key _values_ (`groupId` / `processId` / `queueId`) are unchanged.

## 0.8.0-beta.3

### Minor Changes

- 27eb8c4: Persistence — the two-plane design from `docs/handoffs/queue-persistence-design.md`.

  **Observability plane (history).** `HistoryStore` — a tiny backend-agnostic append-log
  (`append`/`read`, keyed by stream id; `layerMemory` today, SQLite/Postgres later). Each resource
  reads it back via `*History` queries **on the same Tag** as the live stream, fully opt-in via
  `serviceOption` (no store → empty):

  - Queue: `logHistory` + `metricsHistory` (needs `captureLogs` for logs).
  - Process: per-process log **capture** (`captureLogs` on the process layer) feeding `logs` +
    `logHistory`.
  - Runtime-wide: `HostLogs.persistLayer` + `HostLogs.history` (captures _all_ runtime logs).

  Backends: `HistoryStore.layerMemory` (in-process) and `SQLiteHistoryStore.layer` (durable across
  restarts, count-based retention) — same interface, swap the layer.

  **Durability plane.** `DurableQueueStore` — a priority-native store of pending + in-flight work so
  no enqueued item is lost across a restart (**at-least-once** + dedup key). Inspired by Effect's
  `PersistedQueue` (lease / `attempts` / expiry-recovery blueprint) but priority-native, not FIFO:
  strict high/normal/low + FIFO within a lane, dedup + escalation on a `dedupKey`, lease + `recover`,
  `fail` → requeue/dead-letter, `sizes`. SQLite backend (`SQLiteDurableQueueStore` from
  `@nikscripts/effect-pm/storage/sqlite`) over one table; single-writer leasing in a transaction.
  The store port is on the core entry (no SQL dep).

  **Engine integration.** `QueueResource` gains a `persist` option: when set (with a
  `DurableQueueStore` layer + `itemSchema`), the store becomes the source of truth — enqueue persists,
  a feeder leases work into the workers, completion/failure update the store, and a restart recovers
  in-flight work. `size`/`sizes`/`isEmpty`/`status`/`clear` and shutdown-drain are store-aware, and
  the control verbs `release`/`deadLetter`/`drop` operate on the durable backlog (by `entryId`/`key`).
  Fully gated: with `persist` off the in-memory engine is byte-for-byte unchanged.

  A guide for consumers: `docs/guides/history-and-persistence.md`.

- bb6316c: Remove the pre-toolkit legacy layer (plan 17). The `Resource` toolkit + persistence now
  supersede it, so the bespoke control plane and orchestration are deleted:

  - **Control plane:** `ControlService`, `ControlProtocol`, `ControlTransportRpc`,
    `ControlTransportHttp`, `CommandAuth`, `LogTransportRpc`, `Transport` (`httpEndpoint`).
  - **Orchestration:** `ProcessManager`, `ProcessGroup` (+ the `store/ProcessGroup` facet /
    `ProcessGroupStore`, removed from the composed `ProcessStorage`).
  - **Terminal:** `Terminal`, `TerminalRpc` (dropped; use SSH).
  - **Legacy CLI:** `cli` (`createCli`/`runCli`) and the `effect-pm` / `effect-pm-group-child`
    bins.

  Replacements (all shipped): remote control → `Resource.client`/`server`/`serveHttp`/`Host`;
  many instances → `Resource.serveInstances`; group organization → `Group` (nestable);
  runtime-wide logs → `HostLogs`; durability/history → `DurableQueueStore` / `HistoryStore`.
  Their subpath exports are removed. Kept log infra (`LogEntry`/`LogContext`/`Logs`, still named
  `ProcessManagerLog*`) is unchanged; a neutral rename is a separate follow-up.

- 9b3c2d3: Rename the toolkit process tag `ProcessResource` → **`ScheduledProcess`** (namespace + the
  `@nikscripts/effect-pm/ProcessContract` subpath → `@nikscripts/effect-pm/ScheduledProcess`). The
  surface is unchanged — it's a process with lifecycle (`start`/`stop`/`runImmediately`),
  observability (`status`/`logs`/`logHistory`), and schedule control. The name now reflects what it
  is: a _scheduled process_, distinct from a plain schedule. (`Process` remains the lower-level
  engine.) Migration: `ProcessResource.Tag`/`layer`/`server`/`serveHttp` → `ScheduledProcess.*`.

## 0.8.0-beta.2

### Minor Changes

- Tree-shakeable, browser-safe resource tags + one unified `QueueResource` namespace + a clean `strictEffectProvide` gate.

  **Unified `QueueResource`.** The toolkit queue and the engine are now a single `QueueResource` namespace (one import) — `Tag` / `layer` / `configure` / `server` / `serveHttp` plus the engine helpers `make` / `Service` / `Schema` / `Errors`. `Tag` is a normal Effect service driven the same `yield* Tag` whether local or remote.

  **Tree-shakeable browser-safe tags.** Queue, Process, and ProcessSchedule are restructured the Effect way — light contract modules (engine-free `Tag`/spec), shared wire schemas in their own module, namespaces assembled via `export * as`, and `tsup` code-splitting (`splitting: true`) + `"sideEffects": false`. Importing a tag for a browser bundle no longer pulls the engine:

  ```ts
  import * as QueueResource from "@nikscripts/effect-pm/QueueContract";
  import * as ProcessResource from "@nikscripts/effect-pm/ProcessContract";
  import * as ProcessScheduleResource from "@nikscripts/effect-pm/ProcessScheduleContract";
  // QueueResource.Tag / ProcessResource.Tag bundle to ~kb with zero engine code (proven via esbuild).
  ```

  All toolkit modules are also verified to have **no native/node deps** (browser-safe regardless of bundler). Guaranteed _barrel_-namespace tree-shaking (vs the subpath form above) is a tracked follow-up.

  **Process default fix.** A `ProcessResource` runs immediately with its layer (`alwaysArmed` default), matching the engine; pass `schedule: ProcessSchedule.empty` to start disarmed.

  **`strictEffectProvide` cleanup.** The 6 previously-held sites are fixed by building each layer once into its scope and providing the resulting `Context` (rate-limiter and capture-logger in the queue engine; the legacy RPC transport servers). The strict typecheck gate is now clean (0 errors).

## 0.8.0-beta.1

### Minor Changes

- 24e2eff: Adds signed command authentication for `ControlService` and `ProcessManager`.

  Introduces the public `CommandAuth` module, Ed25519 key records, canonical
  command payload signing, replay protection, strict authenticated `POST /control`
  handling, signed `GetHealth`, admin key generation, and ProcessManager public-key
  enrollment helpers.

- 2a3bdcc: Add protocol request/response envelopes for control transports and expose canonical HTTP `POST /control` routing while preserving REST route aliases.
- 8573f33: Add `ControlTransportRpc`, an Effect RPC adapter for dispatching existing `ControlProtocol` envelopes.
- 850f702: Add headless React dashboard primitives and a styled ops-ui shell for adaptive controls and live logs.

  This introduces browser-safe dashboard target types, `<Controls for={...} />`, `<Logs for={...} />`, `useControlPlaneLogs`, and `ControlPlanePort.logs(...)` with live-following NDJSON log streams plus bounded history parameters. It also adds the `@nikscripts/effect-pm/ops-ui` export with `OperatorDashboard` for a production-oriented dashboard shell, icon-only action buttons, status tables, terminal-style live logs, a styled log toolbar, a persisted resizable dashboard grid layout, shadcn-generated local UI components, bounded scrollable widgets, and persisted dashboard chrome visibility state.

- 1ef3134: Reorganize `src/` into Effect-style flat public modules plus `internal/store` and `internal/manager` helpers. **Breaking:** remove `./ProcessStoreGroupLog` and `./QueueResourceStore` package subpaths; facet services are exported under `store/*` subpaths and composed via `ProcessStore.layer` / `store.Log` / `store.QueueResource`. Public PM modules are now `LogContext`, `LogEntry`, and `Transport`; root `index.ts` no longer re-exports internal log query/watch helpers or `groupChild`. Add `relayWithCaptureLoggerLayer` on `@nikscripts/effect-pm/Logs` for child-runtime wiring.
- 8bac9ce: Ship the package as ESM-only (`"type": "module"`).

  The dual CommonJS + ESM build is gone: there is now a single ESM build, and the `require` export conditions are removed (each `exports` entry is `{ types, default }` pointing at the ESM `.js`). `moduleResolution` moves to `bundler` — transparent to consumers since tsup bundles each entry, so no relative imports escape the package. Consumers must import via ESM (`import`), which the only known consumer already does.

  Bonus: with the whole repo on ESM, the terminal UI (Ink, which is ESM-only via yoga-layout's top-level await) now runs directly under `tsx` instead of needing an esbuild→ESM bundle step.

- 10afd42: Organize public exports into namespace objects while keeping short root import aliases.

  Add namespaces across runtime, storage, control, and process-manager modules (`Query`, `ResourceConfigure`, `DisarmedIdleSleep`, `Cli`, `RuntimeStorage`, `ControlProtocol`, `Process`/`ProcessGroup`/`QueueResource` nested `Errors`/`Schema`, `Logs`, `LogEntry`, `LogContext`, expanded `ProcessManager`). Root exports such as `And`, `configureLayer`, `createCli`, and `Endpoint` remain the same bindings as their namespace members (`Query.And`, `ProcessManager.Endpoint`, etc.).

  New subpaths: `@nikscripts/effect-pm/ResourceConfigure` and `@nikscripts/effect-pm/ControlProtocol`.

  This branch is rebased on `main` (configure + export namespaces only). Prisma / durable storage work lives on `cursor/remove-xor-query-958b`.

- eb4cd7c: Add `LogTransportRpc`, an Effect RPC adapter for live process-manager log streams.
- e4a11e2: Add `pm watch` and `pm logs` operator commands with structured log annotations (`groupId`, `processId`, `queueId`). Child runtimes persist captured log lines to a SQLite-backed `ProcessStore` at `.effect-pm/logs/<group>/logs.sqlite`; `pm logs` queries that history by target (group, process, or queue) with date, cursor, limit, and sort flags.

  Unify operator lifecycle commands: `pm start <target>` and `pm stop <target>` dispatch by resolved identifier (group child launch/stop, process controls, or queue start). Remove `group-start`, `group-stop`, and `queue-start`.

- 5777241: Ship `PrismaRuntimeStorage` as a Prisma-backed `RuntimeStorage` adapter over normalized runtime records.

  The Prisma schema fragment now declares `EffectPmRuntimeRecord` mapped to the `effect_pm_runtime_records` table, with indexed columns stored as scalar fields and runtime JSON blobs serialized into string columns. The adapter expects an injected structural client with an `effectPmRuntimeRecord` delegate. Consumers continue to own Prisma generation, migrations, and client lifecycle.

  Add `effect-pm prisma init` for interactively adding the schema fragment to an existing Prisma project, and verify the adapter with both structural mocks and a generated Prisma SQLite client.

  Add typed `RuntimeStorage` operational errors for durable adapters, mapping Prisma / SQLite driver and decode failures into public storage error tags instead of defects.

  **Breaking:** static ProcessStore facet emitters now surface write failures when a storage layer is present. They still no-op when the facet layer is absent. Use the new pipeable `ProcessStore.catchErrorAndLog(...)` helper for writes that should remain best-effort telemetry.

  **Breaking:** SQLite `layerProcessStore` now surfaces typed acquisition errors. Use `layerProcessStoreOrDie` to keep the previous defect-on-acquisition behavior at application edges.

- be2890c: **`ProcessGroupDuplicateDefinitionError`** — `makeProcessGroup` fails at definition time when process names or queue tag keys are duplicated in the group config.
- b3ff52c: Add `ProcessGroup.localEnvLayer` and `ProcessGroupServiceDefinition.localEnvLayer` to compose child runtime env layers without duplicate queue merges. Export `ProcessGroupServiceLayerProvided` on `ProcessGroup.Service.layer` for accurate requirement typing.

  Add `ProcessManager.groupLocalRuntime` as a one-liner `LocalRuntime` + HTTP control descriptor.

  Fix `ControlRouter.layerFromGroup` to accept groups with bundled endpoint config items.

- fe1404b: **ProcessGroup `startAll`** now runs **`QueueHandle.start`** for every registered queue **before** starting processes (pairs with **`QueueResource` `autoStart: false`**).

  Adds **`TypedProcessGroup.startAll`**, **`TypedQueueControls.start`**, contract capability **`start`** on queues, **`POST /queues/:id/start`** on **ControlService**, and **`RemoteQueueControls.start`** / **`POST …/start`** on **ProcessManager**. Multi-group CLI exposes **`queue-start <target>`** (distinct from **`start`** for processes).

- 773eb5f: **Breaking:** `Process.make` now requires `(id, config)` or `(id, effect, …)`; the single-object form with `name` in config is removed. `ProcessMakeOptions` is the public config type (no `name` field). `Process.providePolling` and `Process.provideSchedule` are removed; pass preset polling/schedule layers positionally or on the config object.
- e4160cc: Replace module/runner endpoint shims with child-only `Endpoint.local(transport, entry)`, pipe child stdout/stderr into `.effect-pm/logs`, and add `pm watch` for live structured logs and `pm logs` for stored history.

  Group `watch` streams structured Effect log entries over the control HTTP API (`/logs/stream`) and replays them through the operator logger layer, replacing file tailing of child stdout/stderr.

- a3b0967: Add ProcessManager endpoint config items, endpoint label selection, status probing, module endpoint launcher support, and local group stop/run-state cleanup.
- 773eb5f: Change `Process.make` default schedule from empty in-memory storage to `ProcessSchedule.alwaysArmed` when both `schedule` and `scheduleLayer` are omitted. Add `ProcessSchedule.empty` for apps that relied on the previous disarmed-until-mutation default — pass `schedule: ProcessSchedule.empty` to restore that behavior.
- f3bcbad: **Breaking — rename `ProcessStoreGroupLog` → `LogStore`.**

  The facet that persists structured log entries for the
  `@nikscripts/effect-pm/Logs` capture/relay pipeline never served a single
  `ProcessGroup.Service`; its bucket id (the `groupId` parameter) is an opaque
  partition supplied by the relay (today the PM log annotation from
  `LogContext`). The previous "GroupLog" naming implied a `ProcessGroup`-scoped
  service and conflicted with the distinct `ProcessGroupStore` facet,
  which actually does serve typed process groups.

  Renamed surface (no compatibility shims):

  - `ProcessStoreGroupLog` → `LogStore` (service tag + class)
  - `ProcessStoreGroupLogApi` → `LogStoreApi`
  - `makeProcessStoreGroupLog` → `makeLogStore`
  - Subpath `@nikscripts/effect-pm/store/GroupLog` → `@nikscripts/effect-pm/store/Log`
  - Service key `@nikscripts/effect-pm/store/groupLog/ProcessStoreGroupLog` → `@nikscripts/effect-pm/store/log/LogStore`
  - `ProcessStoreInterface.GroupLog` → `ProcessStoreInterface.Log` (on the
    transitional `ProcessStore` monolith)
  - Wire event `type: "group.log.entry"` → `type: "log.entry"` and
    `entityType: "group"` → `entityType: "log"`
  - `GroupLogEntryRecordedEvent` → `LogEntryRecordedEvent`
  - `isGroupLogEntryRecorded` → `isLogEntryRecorded`
  - File `src/store/groupLog.ts` → `src/store/log.ts`

  Existing SQLite rows with `type: "group.log.entry"` will not decode under the
  new codec. Drain the durable log store or migrate rows before upgrading.

  The deprecated alias `makeLogStores` is removed.

- e713522: Replace the generic `ProcessStoreRuntime` facet with a per-domain
  **`RunResourceStore`** facet (`@nikscripts/effect-pm/store/RunResource`),
  tailored to `RunResource`. Persistence is unchanged at the storage row level
  (facts and state changes still flow through `RuntimeStorage` + spine), but the
  public vocabulary is now strictly per-domain — there is no shared generic
  fact / ref / state-change envelope in any public API.

  `RunResourceStore` is built via
  `ProcessStore.Service<RunResourceStore>()(...)` — one canonical
  class-style facet with a single `record` + `read` block. The class exposes:

  - Static **per-type** optional emitters:
    `RunResourceStore.recordRunStarted`, `.recordRunCompleted`,
    `.recordRunFailed`, `.recordStateChange`, plus the `recordFactBatch` /
    `recordStateChangeBatch` siblings. All no-op when the facet layer is
    absent and persist when composed. Every static emitter is wrapped by a
    built-in `catchCause + logWarning` inside the builder so observation
    failures never reach the caller's success/error channel.
  - Reads via `Effect.serviceOption(RunResourceStore)` then instance
    methods (`.facts`, `.stateHistory`, `.latestState`, `.runs`, `.byRun`) —
    never static methods on the class.
  - Layer accessors: `RunResourceStore.layerRuntimeStorage` (requires
    `RuntimeStorage`) and `RunResourceStore.layer` (in-memory).
  - Type accessors via declaration merging: `RunResourceStore.Type`
    (full service shape, for typing mocks / `Layer.succeed`) and
    `RunResourceStore.EmitType` (record-section emit shape).

  **Wire event types:** `run-resource.fact.recorded`,
  `run-resource.state.changed`. The previous generic `runtime.fact.recorded` /
  `runtime.state.changed` wire types remain in
  `src/internal/store/factEnvelope.ts` as **internal-only** plumbing for
  `QueueResourceStore`.

  **Breaking changes:**

  - Remove the public `ProcessStoreRuntime` facet (`@nikscripts/effect-pm/store/Runtime`).
    Use `RunResourceStore` (`@nikscripts/effect-pm/store/RunResource`)
    instead. Read via `Effect.serviceOption(RunResourceStore)` and
    service instance methods.
  - Remove the generic `RuntimeFact`, `RuntimeRef`, `RuntimeStateBase`,
    `RuntimeStateChange`, `RuntimeFactQuery`, `RuntimeStateHistoryQuery`,
    `RuntimeFactRecordedEvent`, `RuntimeStateChangedEvent` types from the
    public API. Use the concrete `RunResourceRef`, `RunResourceFact`,
    `RunResourceStateBase`, `RunResourceStateChange`, `RunResourceFactQuery`,
    `RunResourceStateHistoryQuery`, `RunResourceFactRecordedEvent`,
    `RunResourceStateChangedEvent` types exported from
    `@nikscripts/effect-pm/store/RunResource`. New domains must publish their
    own concrete types — see [`docs/STORAGE.md`](../docs/STORAGE.md).
  - Remove `ProcessStore.runtime`, `ProcessStore.runResource`, and
    `RuntimeObserver` / `RuntimeObserver.layerFromProcessStore` /
    `RuntimeObserver.layerListeners` / `RuntimeObserver.publishFact` /
    `RuntimeObserver.publishStateChange`. Emissions now go through the
    per-type static optional emitters on `RunResourceStore`;
    in-process listeners are implemented by providing a custom service typed
    as `RunResourceStore.Type` via `Effect.provideService` /
    `Layer.succeed`. See `RunResource`'s module doc and
    `examples/forms/resource/run-resource-runtime-observer.ts` for the
    fan-out pattern.
  - Remove `persistRuntimeObservation` from the public API. The same
    failure-isolation behavior is now built into every static emitter by the
    `ProcessStore.Service` factory; consumers no longer wire it manually.
  - Remove the public `ProcessStoreRuntimeApi` type alias and
    `RuntimeObservationListener` interface. Use `RunResourceStore.Type`
    instead, and declare the local listener bag shape inline in the consumer
    that needs it.
  - `ProcessStore.layerRuntimeStorage` and `layerProcessStore` now merge the
    `RunResourceStore` facet layer in place of `ProcessStoreRuntime`.
  - The `byTimestampDesc` helper in the internal spine now applies a stable
    event-id tiebreaker for events sharing the same millisecond timestamp,
    removing a long-standing flake in `RunResource` projection tests. This is
    observable only as more deterministic ordering on identical-timestamp
    rows in `facts` / `stateHistory` / `events` query results.

- 50ad1ac: **Identifier-bound storage APIs** for the four facets where it carries
  the most weight, plus a doc-comment polish pass across the storage
  surface. All additive — no breaking changes.

  `ProcessStore.withIdentifier(...)` now decorates these facets with
  `Facet.for(id)` / `Facet.withIdentifier(id)` shortcuts that return an
  identifier-scoped read (and, where natural, write) API. The unbound
  `yield* Facet` shape is unchanged.

  ## Added — `for(id)` bindings

  - `QueueResourceStore.for(queueId)` — `entries(query?)`,
    `entriesByKey(key, query?)`, `lifecycle(query?)`, `dedupeKeys(query?)`.
    All four narrow to the bound `queueId` (and still respect any other
    filters supplied through the bound query).
  - `RunResourceStore.for(resourceId)` — `facts(query?)`,
    `stateHistory(query?)`, `latestState()`, `runs()`, `byRun(runId)`.
  - `ProcessLifecycleStore.for(processId)` — `lifecycle(opts?)`,
    `latest()` (returns `Option<ProcessLifecycleTag>`),
    `recordTransition({ tag, error?, occurredAt?, attributes? })`.
  - `ProcessExecutionStore.for(processId)` — `executions(query?)`,
    `hasPriorExecutions()`, `recordCompleted(input)` /
    `recordFailed(input)` / `recordInterrupted(input)` (each takes
    `Omit<ProcessExecutionFinishInput, "processId">`).

  Each facet gained a matching `IdentifierType` namespace alias for typed
  mocks, and the new `RunResourceScopedFactQuery` /
  `RunResourceScopedStateHistoryQuery` / `ProcessExecutionScopedQuery` /
  `ProcessExecutionScopedFinishInput` types are re-exported from the
  package root.

  ## Tests

  18 new conformance tests covering `for(...)` and `withIdentifier({ id })`
  narrowing, scope isolation, identifier-bound writes, and structural
  `IdentifierType` accessors — including a brand-new
  `test/process-store-process-lifecycle-facet.test.ts` suite. Existing
  test surface (254) is unchanged; total now 272 passing.

  ## Documentation

  `docs/STORAGE.md` adds the **identifier-bound APIs** section (table of
  all built-in `for` facets, an authoring template that delegates to
  shared private read helpers) and a section header listing the three
  builder sections (`record`, `read`, `withIdentifier`).

  Module-header polish across `RuntimeStorage`, `ProcessStore`,
  `ProcessStorage`, `ProcessStoreEvent`, `internal/store/spine.ts`, and
  all six storage facets adds:

  - Field-by-field comments on `RuntimeRecord` and per-method comments on
    `ProcessStoreSpine` / `RuntimeStorageService`.
  - "At-a-glance" tables on `RunResourceStore`,
    `QueueResourceStore` (wire types × indexed columns),
    `ProcessExecutionStore`, `ProcessLifecycleStore`,
    `ProcessGroupStore`, `LogStore`.
  - `@example` blocks on `ProcessStorage.layer` /
    `ProcessStorage.layerRuntimeStorage` and on the `ProcessStore` builder.
  - Reworded `ProcessStoreEvent` module + `AnalyticsEventBase` doc to
    drop the "legacy" framing — these primitives are the current shared
    surface, not transitional ones.

- e0c63cd: Add optional deferred worker fork for priority queues: config **`autoStart`** defaults to **`true`** (unchanged behavior). When **`autoStart`** is **`false`**, **`yield* queue.start`** forks the worker pool and lifecycle hook monitor; enqueue still succeeds and items accumulate until then. **`start`** is idempotent and becomes a no-op after **`shutdown`** (warning logged).
- aa84825: **Breaking:** `QueueHandle`, `QueueResource.Service`, `QueueResource.Tag`, and `QueueResourceConfig` reorder type parameters so **worker/requirements channel `R` is last**. Order is **`T`**, **`E`** (worker item effect failure), **`EEnqueue`** (schema enqueue failures, usually `never` without `itemSchema`), **`R`** (ambient services).

  `QueueEnqueue`-shaped enqueue helpers propagate **`R`**, and `ProcessGroup` exports **`ProcessGroupQueueEnqueueRequirements`** alongside **`ProcessGroupQueueEnqueueError`** so typed **`group.queue(Q).add(…)`** reflects enqueue-time dependencies.

  Bundled-queue composition for **`ProcessGroup.Service.layer`** narrows **`Layer.Layer<Self, …, Provided>`** and uses **`Layer.merge`** for remerging queues so Context subtraction stays honest.

- 006879a: **Queue `rateLimit`** — Effect `RateLimiter` on workers (before concurrency semaphore).

  - `rateLimit` config on `QueueResource` / `Service.configure` (`window`, `limit`, `onExceeded` default `"delay"`)
  - `onRateLimitExceeded` hook and `queue.ratelimit.exceeded` on `QueueResourceStore`
  - `queueRateLimiterLayer` for in-memory limiter; `record: "off"` skips exceeded telemetry

- c741f80: Remove the public `Xor` runtime-record predicate from the `Query` DSL.

  `RuntimeRecordPredicate` now supports comparisons plus `And` / `Or` composition only, keeping future storage adapters aligned with common database predicate primitives.

- 164baf7: Location-transparent resource toolkit: drive processes, queues, and schedules with the same `yield* Tag` code whether they run local or remote.

  The `Resource` foundation is now a first-class, exported surface, with batteries-included resource kinds built on it. A resource is defined as a `.Tag` (a `Context.Service` class) and its runtime is a separately-composed `.layer` — the same consumer code runs unchanged whether the resource is provided locally or reached over RPC; only the layer differs.

  **New / newly-exported:**

  - **`Resource`** (foundation) — `Tag` / `layer` / `server` / `serveHttp` / `client` / `connect` / `connectHttp` / `Host`, plus `serveInstances` / `clientInstances` for multi-instance hosting. Contracts are introspectable via the newly-exported **`specOf`** + **`methodMeta`** (`kind` / `description` / `destructive` / `streaming`) — enough to render a generic dashboard/TUI from any tag.
  - **`ProcessResource`** (`@nikscripts/effect-pm/ProcessContract`) — a managed process as a toolkit resource: `statusNow` / `status` / `schedule` / `logs` reads, `start` / `stop` / `runImmediately` lifecycle, and `setSchedule` / `addSchedule` / `clearSchedule`. Auto-arms and runs immediately with its layer (pass `schedule: ProcessSchedule.empty` to start disarmed).
  - **Toolkit `QueueResource`** (`@nikscripts/effect-pm/QueueContract`) — the priority-queue engine behind a location-transparent contract (control + observation + data-plane, remote-proven over http). The barrel `QueueResource` remains the legacy engine during migration; import the toolkit queue from the subpath.
  - **`ProcessScheduleResource`** (`@nikscripts/effect-pm/ProcessScheduleContract`) — a schedule store as its own resource: full CRUD (`entries` / `get` / `has` / `set` / `add` / `upsert` / `remove` / `removeMany` / `clear`), diff-based `reconcile`, and a `changes` stream.
  - **`Group`** (`@nikscripts/effect-pm/Group`) — `Group.Tag` organizes member tags into a nestable tree (`members` / `isGroup`). Pure organization with no runtime: members can run on the same or different hosts, each resolving its own transport (no central manager).
  - **`HostLogs`** (`@nikscripts/effect-pm/HostLogs`) — runtime-wide log capture + stream.

  **Enhancements:**

  - **`.configure` for toolkit resources** — `QueueResource.configure(tag, patch)` / `ProcessResource.configure(tag, patch)` return a config-patch layer (keyed by the tag id) that folds onto the layer's base config at build, for per-environment overrides (concurrency / rateLimit / …). The successor to the old `.Service(...).configure(...)`.
  - **Process run metrics** — `ProcessSnapshot` / `processStatus` gain `runsStarted` / `runsSucceeded` / `runsFailed` and `lastRunStartedAt` / `lastRunDurationMillis`, counted at the single run boundary so they cover scheduled, polling, and `runImmediately` runs.

  All additive — no existing API is removed or changed; the legacy `Process` / `QueueResource` / `ProcessGroup` / `ControlService` surfaces remain during migration.

- e6cae43: **Redis `RuntimeStorage` adapter** (`@nikscripts/effect-pm/storage/redis`).

  - `RedisRuntimeStorage.layer` / `layerProcessStore` — full `RuntimeStorageService` over a `send(command, …args)` transport.
  - `makeInMemoryRedisSend` for tests without a Redis server.
  - Same query, readonly, and `transaction` semantics as memory and SQLite adapters.

- be2890c: **`RuntimeStorage.transaction`** — atomic read/write scopes on memory, SQLite, and Prisma adapters.

  - New `RuntimeStorageService.transaction(effect)` runs `effect` with a transactional
    `RuntimeStorage` in context; commits on success, rolls back on failure.
  - Conformance tests cover commit and rollback semantics.

- 0ff3793: Add semantic `ProcessStore.QueueResource` helpers for queue entry, lifecycle, and dedupe-key records, and wire `QueueResource` to write indexed runtime records through `ProcessStore` when it is available.

  Move the default in-memory `ProcessStore` backing store onto `RuntimeStorage`, with analytics reads projected from normalized records.

  Remove `QueueResource`'s storage-oriented `persist` and `refill` callbacks in favor of `ProcessStore` storage and queue-bound `onStart` / `onDrained` lifecycle hooks.

  Replace queue `handler`, `onEnqueue`, and `onComplete` callbacks with queue lifecycle envelopes such as `onEnqueued`, `onExit`, `onCompleted`, `onFailed`, and retry lifecycle hooks.

  Add pending-entry queue routing controls: `release`, `drop`, and `deadLetter`, plus corresponding lifecycle hooks.

  Add `releaseEncoded` for schema-backed remote/wire handoff while keeping local decoded `release` available without `itemSchema`.

  Move Prisma storage onto the RuntimeStorage adapter over normalized RuntimeRecord rows.

  Map `RuntimeStorage` write failures into `ProcessStoreWriteError` so semantic ProcessStore APIs can surface duplicate and readonly write errors explicitly.

- 3cfc25a: **Breaking — silo per-domain storage facets onto `RuntimeStorage` directly.**

  Storage facets now own their wire codec end-to-end. Shared infrastructure
  (`internal/store/spine.ts`, `internal/store/helpers.ts`) is type-agnostic;
  each facet builds and decodes its own `RuntimeRecord` rows and pushes
  predicates into `RuntimeStorageQuery` directly.

  ## Removed

  - **`AnalyticsEvent` envelope union** and the central
    `internal/store/codec.ts` decoder. Facets no longer share a wire-event
    vocabulary.
  - **`StoreEventQuery`** — replaced by per-facet query types (e.g.
    `QueueEntryQuery`, `RunResourceFactQuery`, `ProcessExecutionQuery`).
  - Shared Prisma event-row types are no longer re-exported from the package root
    or from `ProcessStoreEvent`.
  - **Prisma row codec exports** (`decodeEventRow`, `encodeEvent`,
    decode errors) — removed from `@nikscripts/effect-pm/prisma` and
    `@nikscripts/effect-pm/storage/prisma`. Prisma now targets the `RuntimeStorage`
    adapter contract and no longer
    exposes a row codec at the package boundary.
  - **Per-facet wire-event narrowing helpers**
    (`isQueueEntryRecordedEvent`, `isQueueLifecycleChangedEvent`,
    `isQueueDedupeKeyChangedEvent`) — only the surviving
    `isLogEntryRecorded` guard remains, now exported from
    `@nikscripts/effect-pm/store/Log`.
  - **Internal plumbing** `src/internal/store/codec.ts` and
    `src/internal/store/factEnvelope.ts`. The `FactEnvelope` /
    `FactEnvelopeStateChange` envelope is gone — each facet writes its own
    payload shape.
  - **Legacy spine shims** (`append`, `appendBatch`, `events`) on the
    internal `ProcessStoreSpine`. Facets call `s.create` / `s.createBatch` /
    `s.read` / `s.upsert` / `s.update` / `s.delete` directly.

  ## Reshaped queue wire types

  The queue facet now exposes per-status concrete fact / change types
  instead of a single `runtime.fact.recorded` envelope:

  - `QueueEntryFact = QueueEntryEnqueuedFact | QueueEntryStartedFact | …`
    (one type per `queue.entry.<status>`).
  - `QueueLifecycleChange = QueueLifecycleStartedChange | …` (one type per
    `queue.lifecycle.<tag>`, including the new `queue.lifecycle.drained`).
  - `QueueDedupeKeyChange = QueueDedupeKeyAddedChange | …`.

  Emit API: a single `recordEntry(fact)` / `recordLifecycle(change)` /
  `recordDedupeKey(change)` (plus `*Batch` variants). The previous
  per-status methods (`entryEnqueued`, `entryStarted`, …) and contextual
  binders (`withQueue`, `withEntry`) are gone.

  Read API:

  - `entries(query?: QueueEntryQuery)` with pushable `queueId`, `entryId`,
    `key`, `batchId`, `releaseId`, `types`, and `opts`.
  - `entriesByKey(key, query?)` for cross-queue key lookups.
  - `lifecycle(query?: QueueLifecycleQuery)` and
    `dedupeKeys(query?: QueueDedupeKeyQuery)` with their own pushable
    predicates.

  ## Per-facet ownership

  - `LogEntryRecordedEvent` and `isLogEntryRecorded` now live in
    `src/store/log.ts` (re-exported via the package root).
  - `ProcessLifecycleChangedEvent` / `ProcessLifecycleTag` now live in
    `src/store/processLifecycle.ts`.
  - `ProcessExecutionCompletedEvent` / `ProcessExecutionStatus` now live in
    `src/store/processExecution.ts`.
  - `RunResourceFactRecordedEvent` / `RunResourceStateChangedEvent` are
    removed (the run-resource facet returns concrete `RunResourceFact[]` /
    `RunResourceStateChange[]` already).
  - `ProcessStoreEvent` now exports only `JsonValue`, `QueryOpts`,
    `AnalyticsEventBase`, and the `ProcessStoreWriteError` channel.

  ## `ProcessStore.record(...)` DX flip

  `ProcessStore.record` now takes an object literal of
  `{ [methodName]: (s) => method }` factories instead of a single
  `(s) => api` factory. Emit method names are read from the object literal
  at module load time, which makes the static optional emitters typed
  without runtime introspection. The internal `stubSpine` is gone.

  ## Read query semantics

  `QueueResourceStore`, `ProcessGroupStore`, and
  `ProcessExecutionStore` now apply `opts.limit` to the **post-
  filter** result whenever the storage query is a strict superset of the
  final projection (e.g. group queries that filter by
  `attributes.groupId`, or `executions({ scheduleKey })`). Previously
  `opts.limit` was pushed to storage first, which could collapse a
  `limit: N` query that targeted a sparse post-filter to zero rows. The
  `before` / `after` time window is still pushed down. A new internal
  helper `windowOpts` is shared across the three facets.

  ## Queue dedupe-key emit

  `QueueResource` now writes `queue.dedupe-key.added` rows when items
  acquire a dedupe key on enqueue or when a previously-extracted batch
  is restored after a failed `releaseEncoded`, and
  `queue.dedupe-key.released` rows on completion, `release`, drop,
  dead-letter, and `clear`. The previously-documented dedupe projection
  (`.dedupeKeys`) is now backed by real data instead of being unwired.

  ## Queue retry hook race fix

  `QueueResource.processItem` now releases the dedupe key (and emits the
  `released` change) BEFORE forking the exit hooks, instead of after.
  Hooks that synchronously call `retry` from inside `onFailed` /
  `onExit` no longer race the main fiber for the `activeKeys` ref, and
  the emitted `dedupe-key.released` always precedes the retry's
  re-enqueue `dedupe-key.added` change.

  ## Queue enqueue → worker race fix

  `QueueResource.enqueueInternal` now records its `entry.enqueued` and
  `dedupe-key.added` changes BEFORE waking the worker (`signalWorkerWake`
  is now the last step). The worker thread shares the dedupe-key seq
  counter with the enqueue path; signalling first allowed the worker to
  process and `release` an item before the matching `added` was built,
  producing out-of-order analytics for the same dedupe-key cycle. The
  internal `activeKeys` ref is updated under the enqueue's gate before
  either record/wake step, so the runtime dedup invariant is unchanged.

  ## Worker route fix

  `QueueResource.drop` and `.deadLetter` now persist the caller-supplied
  `reason` as a top-level field on the resulting `queue.entry.dropped` /
  `queue.entry.dead-lettered` fact, instead of nesting it inside
  `attributes`. Reads through `.entries({ types })` therefore expose the
  typed `reason` field directly.

- d26e7ca: Refactor the SQLite `RuntimeStorage` adapter to use Effect SQL (`effect/unstable/sql`’s `SqlClient` via `@effect/sql-sqlite-node`) instead of calling `better-sqlite3` directly from package code.

  **Breaking:** `SQLiteRuntimeStorage.fromDatabase` is replaced by `fromSqlClient`, which installs the schema as an `Effect` and expects an existing `SqlClient`. `makeRuntimeStorage` / `layerRuntimeStorage` now require an ambient `Scope` (use `Effect.scoped` or `@effect/vitest` `it.live`) so the SQLite client lifetime matches the returned port; they use `Layer.buildWithScope` internally. `SQLiteRuntimeStorageOpenError` and direct `better-sqlite3` / `@effect/sql` 0.51 dependencies are removed from the package surface.

  Duplicate primary key inserts map both `UniqueViolation` and SQLite `ConstraintError` (including `SQLITE_CONSTRAINT_PRIMARYKEY`) to `RuntimeStorageDuplicateRecordError`.

  Persist every `RuntimeRecord` field in SQLite, keep query semantics aligned with `RuntimeStorage.memory` via shared `selectRuntimeRecords` evaluation, and document the adapter in the runtime storage guide alongside conformance and persistence tests.

- 09be964: **Breaking — storage facet read/write API and stack cleanup.**

  - Remove the `ProcessStoreBuilder` entry module. Author facets with
    `ProcessStore.Service`, `ProcessStore.record`, and `ProcessStore.read`
    (see `docs/STORAGE.md`).
  - Facet classes expose **static emitters only** for writes. **No static read
    methods** on facet classes (`executions`, `load`, `facts`, etc.).
  - Reads use `Effect.serviceOption(ProcessStoreX)` and `Option.match` with
    explicit `onNone` / `onSome: (store) => store.<read>(...)`. There is no
    `ProcessStore.withFacet` helper and no stub `missing` read API when the
    layer is absent.
  - Add `ProcessStorage` (`@nikscripts/effect-pm/ProcessStorage`) to compose all
    built-in facet layers (memory and `layerProcessStore` / SQLite).
  - Remove NDJSON/file process store (`ProcessStore.file`, `src/storage/file.ts`,
    `examples/forms/process-store/process-store-events-file-layer.ts`,
    `test/process-store.test.ts`).
  - Remove legacy monolith composite (`src/internal/store/composite.ts`).
  - Consolidate storage documentation into `docs/STORAGE.md` (removed scattered
    storage guide copies).

- be2890c: **Breaking — rename storage facet services to `*Store`.**

  | Before                         | After                   |
  | ------------------------------ | ----------------------- |
  | `ProcessStoreQueueResource`    | `QueueResourceStore`    |
  | `ProcessStoreRunResource`      | `RunResourceStore`      |
  | `ProcessStoreLog`              | `LogStore`              |
  | `ProcessStoreProcessExecution` | `ProcessExecutionStore` |
  | `ProcessStoreProcessLifecycle` | `ProcessLifecycleStore` |
  | `ProcessStoreProcessGroup`     | `ProcessGroupStore`     |

  Context tags and `@nikscripts/effect-pm/store/*` subpaths are unchanged.
  `ProcessStorage.QueueResource` (etc.) remain shorthand property aliases.
  `ProcessStore` is still the facet builder module only.

  No deprecated re-exports of old names.

- c838dd6: Adds public remote terminal session contracts and an Effect RPC group for future
  terminal transports.
- f4e2c13: Add typed process group declarations, contracts, and remote management. Processes and queues can now be registered as canonical class services, `ProcessGroup.make(id, entries)` builds a typed group from a single entries tuple, `ProcessGroup.Service` provides an injectable group, `ControlService` exposes schema-validated group contracts at `GET /contract` plus contract-aligned process/queue REST routes, `ProcessManager.connect` creates a typed remote client for supported process/queue controls, and `ProcessManager.Endpoint` provides that remote client as an injectable Effect service.

  `ProcessGroup.remoteLayer` can now provide a group service from a `ProcessManager.Endpoint`. Group service/control errors are widened through `ProcessGroupControlError`, including the new `ProcessGroupRemoteControlError` and `UnsupportedRemoteControlError` exports; remote queue enqueue-style controls remain intentionally unsupported with `UnsupportedRemoteControlError` until schema-backed queue item contracts land.

  `ProcessManager.verifyContract` now compares the remote contract's group id, version, process ids, queue ids, and control sets against the local contract before reporting success.

  `ControlService` is now contract/REST-first: the legacy `POST /control` command endpoint and command request types were removed, and the CLI now calls the REST routes directly.

  `ProcessManager.ConnectionRegistry.layer` and `ProcessManager.ConnectionRegistry.layerConfig` can now provide typed group connection URLs; `ProcessManager.connect(Group)` and registry-backed `ProcessManager.Endpoint(Group)` can build remote managers from that registry requirement.

  `ProcessManager.cli([GroupA, GroupB])` adds an initial multi-group CLI surface using the connection registry and normalized target resolution for globally unique process and queue ids. It supports `groups`, `ls`, `verify`, `status <target>`, process `start` / `stop` / `restart` / `now`, and queue `pause` / `resume` / `clear`.

  The multi-group CLI supports `--json` output for `groups`, `ls`, `verify`, and `status <target>`.

  The multi-group CLI now checks target contract capabilities before issuing remote status/control requests, so unsupported process and queue commands fail locally before HTTP.

  Adds the first runtime state/fact vocabulary for `RunResource`. Originally landed as a generic `RuntimeObserver` + `RuntimeFact` model; it has since been re-shaped into a per-domain **`RunResourceStore`** storage facet (`@nikscripts/effect-pm/store/RunResource`) — see the separate `process-store-runtime-facet` changeset for the breaking shape. `RunResource` publishes `run-resource.run.started` / `run-resource.run.completed` / `run-resource.run.failed` facts plus `RunResourceState` transitions through `RunResourceStore.recordRunStarted` / `.recordRunCompleted` / `.recordRunFailed` / `.recordStateChange` static optional emitters, which no-op when the facet layer is absent and persist as `run-resource.fact.recorded` / `run-resource.state.changed` analytics events when composed. The Prisma codec supports those event types.

  In-process listeners are implemented by providing a custom service typed as `RunResourceStore.Type` via `Effect.provideService` / `Layer.succeed` — there is no `RuntimeObserver.layerListeners` helper.

  `ProcessStore.events(query)` now provides a generic storage-neutral event read across memory, file-backed, and Prisma implementations. Dedicated queue completion and lifecycle reads are also available across those stores.

  Per-domain projections live directly on the facet: `RunResourceStore.facts({ resourceId, runId?, types? })`, `.stateHistory({ resourceId })`, `.latestState(resourceId)`, `.runs(resourceId)` (paired started + ended history per run), and `.byRun(runId)` (facts for one specific run). There is no `ProcessStore.runtime.*` / `ProcessStore.runResource.*` namespace on the combiner.

  `RunResource` now publishes `RunResourceState` changes for waiting, started, completed, failed, and interrupted runs through `RunResourceStore.recordStateChange`.

  `ProcessStore.file(filePath)` and `ProcessStore.fileLayer(filePath)` add an Effect `FileSystem`-backed NDJSON store for local durable analytics events.

  Adds dedicated package subpaths for service/resource imports (`/Process`, `/QueueResource`, `/ProcessGroup`, `/ProcessStore`, `/ProcessManager`, `/ControlService`) and storage adapters (`/storage/file`, `/storage/prisma`). Root imports and the legacy `/prisma` subpath remain compatible.

  Also fixes `ProcessStore` execution ordering consistency and keyed queue `clear()` dedup cleanup.

### Patch Changes

- Clean stale branch-era docs, add a focused QueueResource example, and repair the combined post-merge type fixes.
- d6beaf3: Update the Effect v4 beta toolchain to `4.0.0-beta.69` and raise the package peer range to `^4.0.0-beta.69`.
- 6ce4729: **QueueResource**: Split worker wake (`takeNext`) from drain-monitor wake so idle workers never unblock `onDrained`; enqueue only wakes workers. The `onDrained` lifecycle hook wakes after queues drain empty following item completion or after `clear`.
- 95cc8e1: **QueueResource**: Replace **`config.refill`** and **`QueueHandle.refill`** with queue-bound lifecycle hooks. Use **`onStart(queue)`** for bootstrap work and **`onDrained(queue)`** after queues drain empty once activity has awakened the drain monitor. Cold-start idle workers do not trigger **`onDrained`**.
- 83bf98c: Document the roadmap to re-enable `anyUnknownInErrorContext` in `@effect/language-service` (see `docs/plans/10-typescript-strict-unknown.md`). Includes small refinements to ControlService, CLI, disarmed idle sleep, shared helpers, HTTP resource/run gate modules, and expanded `ProcessStore` public TSDoc.

## Unreleased

### Minor Changes

- Add `Process.scheduleControls` so schedule controls (`entries`, `set`, `add`, `clear`) are available inside running process effects, matching the controls passed to the `schedule` initializer.
- Add a new schedule-control example (`examples/schedule-control-surfaces.ts`) demonstrating three control surfaces: initializer controls, in-effect controls, and external controller fibers.
- Add two additional schedule-focused examples for organization and breadth: `examples/schedule-control-basics.ts` and `examples/schedule-control-db-sync.ts`.
- Expand schedule-focused tests to cover in-effect schedule controls and change-signal behavior.

## Current beta

### Minor Changes

- **Breaking — effect-first process runtime:** `Process.make` is centered on **`effect`**, with optional **`polling`** (`Polling.spaced`, `Polling.acceleratingScoped`, …) and **`schedule`** (`ProcessSchedule.alwaysArmed`, `ProcessSchedule.cronMatch`, `ProcessSchedule.fromArmedRef`, …) as **layers**. Compose at `make`, via **`Process.providePolling`** / **`Process.provideSchedule`**, or when providing **`process.effect`** at fork time.
- **`Polling` / `ProcessSchedule`:** context services and preset layers; **`ProcessDetails`** / **`ProcessGroup`** status expose **`armed`**, **`nextPollCadence`**, and schedule transition hints where available.
- **Supervisor:** **`start` / `startAll`** attaches schedule drivers; **disarm** pauses scheduled ticks while the fiber **waits** (hint-based or fallback idle sleep, **`Clock`**-aligned); **`cronMatch`** sampling uses the same **`Clock`**.
- **Resource modules:** `QueueResource`, `RunResource`, `HttpClientGate`, and `HttpApiResource` use the current class/service patterns documented in **`docs/RESOURCE-API.md`**.
- **Docs & examples:** **`docs/PROCESS-API.md`**, **`docs/RESOURCE-API.md`**, **`examples/queue-resource.ts`**, and the examples index describe the current beta surface.
