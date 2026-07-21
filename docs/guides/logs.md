{#logs title="Logs" status="draft" appliesTo=all}
# Logs

Logs in effect-pm are one pipeline: every `Effect.log` on a [Node](/docs/glossary#node) lands on a
single live bus, and — when you register journals on your [Store](/docs/stores) — durable followers
persist those lines into scoped history. You consume the same lines live (`Logs.stream`,
`Resource.logs`) or from Storage (`Logs.byNode`, `Logs.byResource`).

There is no separate “process log API” and “queue log API.” Capture is central. Scopes are how you
carve the bus into journals and Handle-facing exports.

This chapter is the narrative guide. Deep tables and fixture indexes remain in
[`docs/LOGS.md`](https://github.com/NikScripts/effect-pm/blob/integration/docs/LOGS.md) when you need
a lookup.

## What you get

A finished Node stack looks like this:

```
Your Node (key: billing/scores)
  Store.Service
    └── Logs.layer          — one capture Logger + Logs.Relay bus
    └── BillingNode.logs    — match-all durable tail → node journal
    └── Process.store(Daily)— lineage durable tail → resource journal
  Process / Queue layers
    └── Logs.withScope(tag) — appends tag.key onto the fiber lineage path
```

- **Capture** — exactly one merged capture Logger per Node (`Logs.layer`, baked into
  `Store.Service`).
- **Bus** — one `Logs.Relay`: PubSub plus a bounded in-memory snapshot for late subscribers.
- **Durable tails** — one Stream follower per store registration: level gate → match → append to that
  registration’s private `_logs` journal (Effect-style underscore field — not on public handle types).
- **Lineage** — a JSON array of segment keys on each line (`Logs.withScope`), so filters can select by
  Resource or by ancestry.
- **Export** — `Resource.logs(tag)` for `{ stream, query }` on a Resource Handle surface. Prefer this
  for app reads; apps may freely declare their own Store shape named `log`.

{.note}
**Two copies are intentional.** If both `Node.logs` and `Process.store(Daily)` are registered, the
same published line can appear in the node journal *and* the resource journal. Dedup is per scope, not
global.

## Your first live bus

Provide `Logs.layer` and every log on that fiber context reaches the bus:

{.twoslash}
``` ts
import { Logs } from "@nikscripts/effect-pm"
import { Effect, Fiber, Stream } from "effect"

const program = Effect.gen(function* () {
  // Subscribe before you log if you need the first lines (live fan-out).
  const collector = yield* Effect.forkChild(
    Stream.runCollect(Stream.take(Logs.stream, 1)),
  )
  yield* Effect.logInfo("hello from the bus")
  const [entry] = Array.from(yield* Fiber.join(collector))
  return entry?.message
})

// Provide Logs.layer at the Node root (or rely on Store.Service, which bakes it in).
const runnable = program.pipe(Effect.provide(Logs.layer), Effect.scoped)
```

`Logs.snapshot` is the bounded tail already held on the relay — useful for “what just happened” without
opening a Stream. `Logs.replay` re-emits a captured `LogEntry` through the ambient Logger.

## Durable journals

Live-only is enough for ephemeral UIs. History needs Storage.

Register journals on a `Store.Service`. Node-wide history uses `Node.logs` (or
`Resource.store(Node)`). Per-Resource history uses the toolkit store registration —
`Process.store(tag)`, `QueueResource.store(tag)`, and friends — which carry a private `_logs`
journal. Read durable history with `Logs.byNode` / `Logs.byResource` / `Resource.logs(tag).query`
(not a public `handle.log` surface).

{.twoslash}
``` ts
import { Logs, Process, Resource, Store } from "@nikscripts/effect-pm"
import { Effect } from "effect"

class BillingNode extends Resource.Node<BillingNode>("billing/scores") {}
class Daily extends Process.Tag<Daily>()("app/Daily") {}

class AppStore extends Store.Service<AppStore>("@app/Store")(
  BillingNode.logs,
  Process.store(Daily),
) {}

const program = Effect.gen(function* () {
  // Node journal — every line the match-all follower persisted for this Node.
  const nodeRows = yield* Logs.byNode(BillingNode, { limit: 200 })

  // Resource journal — that registration's scope (same key as Daily.key).
  const resourceRows = yield* Logs.byResource(Daily, { limit: 100 })

  // Preferred: live + durable product export for the tag.
  const { query } = yield* Resource.logs(Daily)
  const fromExport = yield* query({ limit: 100 })

  return { nodeRows, resourceRows, fromExport }
})
```

### Layer order

Toolkit `layer` / `serve` soft-default in-memory `Storage` (**R fulfilled**). Provide your
`Store.Service` **into** the resource Layer so Soft unwrap captures that store — especially
before queue workers fork at Layer build:

``` ts
Effect.provide(
  program,
  QueueResource.layer(MyQueue, { effect: worker }).pipe(
    Layer.provideMerge(AppStore.layerMemory),
  ),
)
```

Bare `QueueResource.layer` / `Process.layer` (or `*Memory` aliases) work without an AppStore;
durable logs still need `Store.Service.layer*`. Recipe SSOT: [`docs/guides/stores.md`](./stores.md).

## Keys

Say the identifier kind out loud. Mixing them is the common failure mode.

| Kind | Identifies | Declared as | Used for |
|------|------------|-------------|----------|
| **Node log key** | One OS process / runtime host | `Resource.Node(…)` → `.key` | `Node.logs`, `Logs.byNode`, `annotations.node` |
| **Resource key** | One Queue, Process, or custom Tag | `Tag(…)` → `.key` | store scope, lineage segments, `byResource` |
| **Lineage segment** | One hop in ancestry | element of the lineage JSON array | `LogEntry.hasKey` / `atRoot` / `atLeaf` |
| **Annotation key** | Field name on `LogEntry.annotations` | `LogAnnotationKeys.*` | metadata keys, not buckets |

``` ts
BillingNode.key          // node log key  — "billing/scores"
Daily.key                // resource key  — "app/Daily"
LogAnnotationKeys.node   // annotation key — "node" (holds a node log key value)
LogAnnotationKeys.lineage // annotation key — JSON array of lineage segment keys
```

### Node log key rules

1. It **must equal** that process’s `Resource.Node` key — `BillingNode.key`, not an invented
   `"my-node"`.
2. Prefer slash-separated paths (`domain/role`): `"billing/scores"`, `"wnba/live"`.
3. Every node-journal line is stamped with `annotations.node` = that key.
4. Query with `Logs.byNode(BillingNode)` (or the string key, if unknown statically).

``` ts
// ❌ drifts from Resource.Node
Logs.byNode("wnba")          // WnbaNode.key is "wnba/scores"
Logs.byNode("my-node")
```

### Resource keys

Resource identity is `tag.key` (may contain `/`; some metrics Tags use an `@` prefix). Resource
journals, lineage filters, and `Resource.logs` all key off that string.

## Lineage

Each log line may carry a **lineage path**: an ordered list of segment keys under
`LogAnnotationKeys.lineage`. Engines stamp it with `Logs.withScope(tag)` when they materialize work —
Process and Queue do this for you.

`withScope` is **append-only**. Nested scopes combine:

``` ts
effect
  .pipe(Logs.withScope(Child))
  .pipe(Logs.withScope(Parent))
// fiber lineage → ["parent/Key", "child/Key"]
```

Re-entering the same leaf key is idempotent (no duplicate last segment). A Node root is **not**
auto-injected into lineage; the node journal uses `annotations.node` instead.

### Predicates

``` ts
import { LogEntry } from "@nikscripts/effect-pm"

LogEntry.lineage(entry)                 // ReadonlyArray<string>
LogEntry.hasKey(resourceKey)(entry)     // key anywhere in the path
LogEntry.atRoot(segment)(entry)         // lineage[0] === segment
LogEntry.atLeaf(resourceKey)(entry)     // last segment === resourceKey
```

Legacy `processId` / `queueId` annotations are gone — writers stamp lineage only via `Logs.withScope`.
Resource kind is `Resource.kindOf(tag)`, not an annotation field.

## Per-resource export

Prefer `Resource.logs(tag)` for Handle-shaped access — live Stream plus durable query:

{.twoslash}
``` ts
import { LogEntry, Process, Resource } from "@nikscripts/effect-pm"
import { Effect } from "effect"

class Daily extends Process.Tag<Daily>()("app/Daily") {}

const program = Effect.gen(function* () {
  const { stream, query } = yield* Resource.logs(Daily)

  // Live: already filtered to lineage containing Daily.key (plus optional stream level).
  // Durable: registration Storage when local; NodeStatus fallback when remote.
  const history = yield* query({ limit: 50 })
  const mine = history.filter(LogEntry.hasKey(Daily.key))

  return { stream, mine }
})
```

Pipe `Resource.withLogExport` onto a Tag when you want `yield* Tag.logs` as a member:

``` ts
class MailQueue extends QueueResource.Tag<MailQueue>()("app/Mail", MailJob).pipe(
  Resource.withLogExport,
) {}

const { stream, query } = yield* MailQueue.logs
```

On the raw bus, filter yourself:

``` ts
Logs.stream.pipe(Stream.filter(LogEntry.hasKey(Daily.key)))
```

## Levels

Two knobs, two jobs:

| API | Affects |
|-----|---------|
| `Store.logLevel*` / registration log level | What the **durable tail** persists for that scope |
| `Store.streamLevel*` on a registration (or `Resource.logStreamLevel*` on a Tag) | What `Resource.logs(tag).stream` emits live |

``` ts
class AppStore extends Store.Service<AppStore>("@app/Store")(
  Store.streamLevelWarn(Process.store(QuietProc)),
  BillingNode.logs,
) {}

// Tag-side live floor (Resource.logs stream)
class QuietProc extends Process.Tag<QuietProc>()("app/Quiet").pipe(
  Resource.logStreamLevelWarn,
) {}
```

`"All"` means no floor. `"None"` drops everything for that surface.

## Remote clients

When the dashboard (or any client) reaches a Node over RPC, durable per-resource rows come from that
Node’s journal — typically `NodeStatus.logs.query` — filtered by **resource key**. Locally,
`Resource.logs(tag).query` prefers registration Storage and falls back to NodeStatus when Storage
isn’t there.

``` ts
import { LogEntry, NodeStatus } from "@nikscripts/effect-pm"
import { Stream } from "effect"

const resourceKey = LiveScorePoller.key

NodeStatus.logs.stream.pipe(Stream.filter(LogEntry.hasKey(resourceKey)))

const rows = yield* NodeStatus.logs.query({ limit: 300 })
const scoped = rows.filter(LogEntry.hasKey(resourceKey))
```

The server must still provide a `Store.Service` with `Node.logs` (and any toolkit stores you care
about) on the Node stack. `httpServer` infers the node log key from served Tags’ bound Node for
`NodeStatus.logs.query`.

## Modules

| Concern | Package | Role |
|---------|---------|------|
| Platform | `@nikscripts/effect-pm/Logs` | Layer, bus, `withScope`, `byNode` / `byResource` |
| Entry + predicates | `@nikscripts/effect-pm/LogEntry` | Wire shape, `hasKey` / `atRoot` / `atLeaf` |
| Annotation keys | `@nikscripts/effect-pm/LogContext` | `LogAnnotationKeys` |
| Export | `@nikscripts/effect-pm/Resource` | `logs`, `withLogExport`, `logStreamLevel*` |
| Journals | `@nikscripts/effect-pm/Store` | `Store.Service`, `Node.logs`, toolkit `.store` |

## Migration (removed surfaces)

| Old | Use instead |
|-----|-------------|
| `Logs.persistLayer` + `store/Log` | `Node.logs` + toolkit `.store` on `Store.Service` |
| `NodeLogs.*` | `Logs.*` |
| `LogRelay` / `replayLogEntry` / `*RelayLayer` flat aliases | `Logs.Relay` / `Logs.replay` / `Logs.layer` |
| Engine `captureLogs` / handle `.logs` | `Logs.layer` + `Logs.withScope` + `Resource.logs` |
| `HistoryStore` `` `${tag.key}/logs` `` | Registration `_logs` + `Resource.logs` / `Logs.by*` |

## See also

- [Stores](/docs/stores) — registering journals and reading Storage  
- [`docs/LOGS.md`](https://github.com/NikScripts/effect-pm/blob/integration/docs/LOGS.md) — key catalog and fixture map  
- [Queues](/docs/queues) / [Processes](/docs/processes) — engines that stamp lineage at materialize  
