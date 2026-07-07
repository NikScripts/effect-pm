# Resource API Reference

Complete guide to `QueueResource`, `CustomQueueResource`, `RunResource`, and `HttpApiResource` — the managed resource modules in `@nikscripts/effect-pm`.

---

## Resource kinds

Every contract's `.Tag` factory stamps a canonical **kind** id on the tag it builds, so consumers can classify a tag by *what it is* rather than sniffing its spec members (which is fragile — e.g. a queue and an `ApiMetrics` tap both expose a `metrics` stream).

```ts
import * as Resource from "@nikscripts/effect-pm/Resource";
import * as QueueResource from "@nikscripts/effect-pm/QueueResource";

Resource.kindOf(MyQueue);        // "@nikscripts/effect-pm/QueueResource"
Resource.kindOf(MyQueue) === QueueResource.kind; // true
Resource.kindOf(SomePlainTag);   // undefined  (a bare Resource.Tag carries no kind)
```

`Resource.kindOf(tag)` accepts `unknown` (so a `Group` member passes straight in) and returns the kind id or `undefined`. Each contract exports its id as `kind`:

| Contract | `kind` |
| --- | --- |
| `QueueResource` (`…/QueueContract`) | `@nikscripts/effect-pm/QueueResource` |
| `Process` (`Process.Tag`) | `@nikscripts/effect-pm/Process` |
| `Process.Schedule` (standalone schedule) | `@nikscripts/effect-pm/Process/Schedule` |
| `CustomQueueResource` (`…/CustomQueueContract`) | `@nikscripts/effect-pm/CustomQueueResource` |
| `ApiMetrics` | `@nikscripts/effect-pm/ApiMetrics` |

This is how the web/TUI dashboards pick the right widget for each `Group` leaf. A bare `Resource.Tag` has no stamped kind; pass `{ kind }` to `Resource.Tag(key, { kind })` / `Resource.tagFor(groupId, spec, { kind })` to give a custom contract its own.

---

## QueueResource

Priority queue with managed workers, deduplication, retry, and lifecycle hooks.

### Construction patterns

#### Class declaration (primary — config baked in)

```typescript
import { Effect, Exit } from "effect"
import { QueueResource } from "@nikscripts/effect-pm"

class EmailQueue extends QueueResource.Service<EmailQueue, Email, SmtpError>()(
  "@app/EmailQueue",
  {
    effect: (email, ctx) => smtpClient.send(email).pipe(Effect.asVoid),
    onExit: ({ exit, retry }) =>
      Exit.match(exit, {
        onFailure: () => retry,
        onSuccess: () => Effect.void,
      }),
    concurrency: 10,
    capacity: 100_000,
    retries: 3,
    onRetryExhausted: ({ entry }) => deadLetterQueue.add([entry.item]),
  },
) {}

// Use:
const queue = yield* EmailQueue
yield* queue.add([email1, email2])
// Provide:
Effect.provide(EmailQueue.layer)
```

#### Tag (pure identity — implementation provided separately)

```typescript
class NotificationQueue extends QueueResource.Tag<NotificationQueue, Notification, never, never>()(
  "@app/NotificationQueue",
) {}

// Provide implementation in different environments:
const NotificationQueueDev = QueueResource.layer(NotificationQueue, {
  effect: (n) => Effect.logInfo(`[DEV] Would send: ${n.message}`),
  concurrency: 1,
})

const NotificationQueueProd = QueueResource.layer(NotificationQueue, {
  effect: (n) => pushService.send(n).pipe(Effect.asVoid),
  concurrency: 20,
})
```

#### Raw make (no tag, scoped)

```typescript
const program = Effect.scoped(
  Effect.gen(function*() {
    const queue = yield* QueueResource.make({
      name: "temp-work-queue",
      effect: (item: string) => Effect.logInfo(String(item.length)),
      concurrency: 5,
    })
    yield* queue.add(["hello", "world"])
    // queue is automatically cleaned up when scope closes
  })
)
```

### Service shape (`QueueHandle<T, E, EEnqueue, R>`) — **`R`** is last: ambient services workers need

```typescript
const queue = yield* MyQueue

// ─── Enqueue (accepts Iterable<T>) ───
yield* queue.add([item1, item2])        // normal priority
yield* queue.prioritize([urgentItem])   // high priority (processed first)
yield* queue.defer([backgroundItem])    // low priority (processed last)

// ─── Observe (effectful properties — no parens) ───
const total = yield* queue.size         // total pending across all levels
const perLevel = yield* queue.sizes     // { high: number, normal: number, low: number }
const empty = yield* queue.isEmpty      // true if all levels empty
const done = yield* queue.completed     // items processed since workers began draining

// ─── Lifecycle (effectful properties) ───
yield* queue.start                      // fork workers when `autoStart: false` was set at construction
yield* queue.pause                      // workers block before next item
yield* queue.resume                     // workers unblock
yield* queue.shutdown                   // permanent stop, enqueue drops items
const cleared = yield* queue.clear      // drain all queues, reset counter
const released = yield* queue.release({ releaseId: "deploy-42" }) // export pending entries for handoff
const encoded = yield* queue.releaseEncoded({ releaseId: "deploy-42" }) // schema-backed wire handoff
yield* queue.drop({ key: "obsolete" }, { reason: "cancelled" })
yield* queue.deadLetter({ key: "poison" }, { reason: "max retries" })
```

### Configuration reference

```typescript
QueueResource.Service<Self, T, E>()("name", {
  // ─── Required ───
  effect: (item: T, ctx: EffectContext<T>) => Effect<R, E>,

  // ─── Concurrency ───
  concurrency: 5,        // worker count (default: 5)
  capacity: 50_000,      // max items per priority queue (default: 50,000)
  paused: false,         // start paused? (default: false)
  autoStart: true,       // fork workers at acquisition (default: true); false → call `yield* queue.start`

  // ─── Deduplication ───
  key: (item) => item.id, // extract dedup key; duplicates silently dropped

  // ─── Retry (hook-driven) ───
  retries: 3,             // max re-enqueues via event.retry
  onRetryExhausted: ({ entry, cause }, queue) => ...,  // called when limit reached

  // ─── Hooks (fire-and-forget) ───
  onEnqueued: (batch, queue) => metrics.increment("enqueued", batch.entries.length),
  onExit: ({ entry, exit, elapsed, retry }, queue) => Effect.void,
  onCompleted: ({ entry, elapsed }, queue) => metrics.record("duration", elapsed),
  onFailed: ({ entry, cause, elapsed, retry }, queue) => retry,
  onReleased: ({ entries, releaseId }, queue) => auditRelease(releaseId, entries),
  onDropped: ({ entries, reason }, queue) => auditDrop(reason, entries),
  onDeadLettered: ({ entries, reason }, queue) => auditDeadLetter(reason, entries),
  onStart: (event, queue) => queue.add(seedItems),
  onDrained: (event, queue) => queue.add(fetchMoreWork),
})
```

### EffectContext (passed to `effect`)

```typescript
effect: (item, ctx) => Effect.gen(function*() {
  // ─── Metadata ───
  ctx.attempts   // number: 1 = first try, 2 = first retry, etc.
  ctx.enqueuedAt // number: epoch millis when item first entered queue
  ctx.priority   // "high" | "normal" | "low"

  // ─── Enqueue derived work (guarded: self-enqueue warned + dropped) ───
  yield* ctx.add([derivedItem1, derivedItem2])
  yield* ctx.prioritize([urgentDerived])
  yield* ctx.defer([backgroundDerived])
})
```

### Lifecycle hooks

```typescript
onExit: ({ entry, exit, elapsed, retry }, queue) => Effect.gen(function*() {
  entry.attempts                 // number
  entry.timestamps.enqueuedAt    // DateTime.Utc
  entry.priority                 // "high" | "normal" | "low"

  // Retry re-enqueues the same item at the back of the same priority queue.
  yield* retry

  // Queue-bound controls can route follow-up work.
  yield* queue.add([newItem])
  yield* queue.prioritize([escalated])
  yield* queue.defer([demoted])
})
```

### Patterns

#### Error handling with retry + dead letter

```typescript
class OrderQueue extends QueueResource.Service<OrderQueue, Order, OrderError>()(
  "@app/OrderQueue",
  {
    effect: (order) => processOrder(order),
    onExit: ({ entry, exit, retry }, queue) =>
      Exit.match(exit, {
        onFailure: () =>
          entry.attempts < 3
            ? retry
            : queue.defer([entry.item]),  // demote to low priority after 3 fails
        onSuccess: () => Effect.void,
      }),
    retries: 5,
    onRetryExhausted: ({ entry }) => Effect.logError(`Order ${entry.item.id} permanently failed`),
    concurrency: 10,
  },
) {}
```

#### Deduplication (by item key)

```typescript
class WebhookQueue extends QueueResource.Service<WebhookQueue, WebhookEvent, never>()(
  "@app/WebhookQueue",
  {
    effect: (event) => deliverWebhook(event),
    key: (event) => event.deliveryId,  // duplicate deliveryIds silently dropped
    concurrency: 20,
  },
) {}
```

#### Spawning derived work from effect

```typescript
class CrawlQueue extends QueueResource.Service<CrawlQueue, URL, CrawlError>()(
  "@app/CrawlQueue",
  {
    effect: (url, ctx) => Effect.gen(function*() {
      const page = yield* fetchPage(url)
      const links = extractLinks(page)
      yield* ctx.add(links)  // enqueue discovered links (guarded: same URL dropped)
    }),
    key: (url) => url.href,  // dedup by URL
    concurrency: 5,
  },
) {}
```

#### Start paused, load items, then resume

```typescript
class BatchQueue extends QueueResource.Service<BatchQueue, Job, never>()(
  "@app/BatchQueue",
  {
    effect: (job) => processJob(job),
    paused: true,  // starts paused — items accumulate before processing
    concurrency: 8,
  },
) {}

// In your program:
const queue = yield* BatchQueue
yield* queue.add(yield* loadInitialBatch())
yield* queue.resume  // now workers start in priority order
```

---

## CustomQueueResource

N-level priority queues sharing the same worker engine as `QueueResource`, with a numeric lane store and
pluggable take algorithm (`priority`, `strict-descending`, `weighted`, or custom pick). Use when the
fixed high/normal/low trio is not enough.

**Default `QueueResource` is unchanged** — custom lanes live in a separate type and subpath so the
default import graph stays lightweight (scheduled lane code is dynamically imported only when
`takeAlgorithm: "weighted"` or similar is selected).

### When to use which

| Need | Use |
|------|-----|
| Three priorities (`add` / `prioritize` / `defer`) | `QueueResource` |
| Many lanes, named levels, WFQ / strict ordering | `CustomQueueResource` |

### Toolkit tag (recommended)

Tag factory arity mirrors positional lane config:

```typescript
import { CustomQueueResource } from "@nikscripts/effect-pm"
import { Schema } from "effect"

const Job = Schema.Struct({ id: Schema.String })

// (id, schema, levelCount, namedLevels?)
class Jobs extends CustomQueueResource.Tag<Jobs>()(
  "@app/Jobs",
  Job,
  8,
  { urgent: 0, batch: 7 },
) {}

// or: (id, schema, levelNames[]) — indices assigned 0…n−1
class Lanes extends CustomQueueResource.Tag<Lanes>()(
  "@app/Lanes",
  Job,
  ["urgent", "normal", "batch"],
) {}

const queue = yield* Jobs
yield* queue.add({ id: "a" }, "urgent")
yield* queue.add([{ id: "b" }, { id: "c" }], 7)

const sizes = yield* queue.sizes       // Record<string, number> by configured name
const numeric = yield* queue.levelSizes // number[] indexed by lane
```

Tree-shake the contract only (no engine on the tag import path):

```typescript
import * as CustomQueueResource from "@nikscripts/effect-pm/CustomQueueResource"
```

### Layer / engine

```typescript
CustomQueueResource.layer(Jobs, {
  levelCount: 8,
  namedLevels: { urgent: 0, batch: 7 },
  takeAlgorithm: "weighted", // or "priority" | "strict-descending" | CustomTakeAlgorithm
  effect: (job) => process(job),
  concurrency: 5,
})

// Local engine without toolkit tag:
import { CustomQueueResource as CustomQueueEngine } from "@nikscripts/effect-pm/CustomQueueResource"

const queue = yield* CustomQueueEngine.make({
  levelCount: 4,
  namedLevels: { fast: 2 },
  effect: (item) => Effect.log(String(item)),
})
```

### Service shape differences from `QueueResource`

- **`add(item, level?)`** — optional lane as numeric index or configured name (not `{ item, level }`).
- **`sizes`** — `Record<string, number>` keyed by name (unnamed lanes appear as `"0"`, `"1"`, …).
- **`levelSizes`** — `number[]` parallel to lane indices.
- No `prioritize` / `defer` — pick the lane explicitly on `add`.

Subpaths: `@nikscripts/effect-pm/CustomQueueResource` (namespace + engine), `@nikscripts/effect-pm/CustomQueueResource` (tag/layer/server only).

Example: [`examples/forms/queue/custom-queue-resource-n-level.ts`](../examples/forms/queue/custom-queue-resource-n-level.ts) (`pnpm run example:custom-queue-resource`).

---

## RunResource

Concurrency gate (semaphore) around any effect. No queues, no workers — just bounded parallelism.

### Construction patterns

#### Class declaration (parameterized gate)

```typescript
class SendSms extends RunResource.Service<SendSms>()("@app/SendSms", {
  payload: PhoneNumberSchema,
  success: SmsResultSchema,
  error: SmsErrorSchema,
  effect: (phone) => twilioClient.send(phone),
  concurrency: 5,
}) {}

const send = yield* SendSms
const result = yield* send.run("+1234567890")
// or: yield* SendSms.run("+1234567890")
```

#### Class declaration (unit gate — no input)

```typescript
class RefreshPrices extends RunResource.Service<RefreshPrices>()("@app/RefreshPrices", {
  payload: Schema.Void,
  success: PriceDataSchema,
  error: FetchErrorSchema,
  effect: () => fetchLatestPrices(),
  concurrency: 1,  // only one refresh at a time
}) {}

const refresh = yield* RefreshPrices
const prices = yield* refresh.run()
```

#### Generic runner (wraps any effect)

```typescript
const DbPool = RunResource.makeRunner({
  name: "@app/DbPool",
  concurrency: 20,  // max 20 concurrent DB queries
})

const runner = yield* DbPool
const users = yield* runner(db.query("SELECT * FROM users"))
const orders = yield* runner(db.query("SELECT * FROM orders"))
```

#### Tag + layer (dependency inversion)

```typescript
const ApiGate = RunResource.Tag<ApiGate>()(
  "@app/ApiGate",
  RequestSchema,
  ResponseSchema,
  ApiErrorSchema,
)

// Dev: no limit
const ApiGateDev = RunResource.layer(ApiGate, {
  effect: (req) => httpFetch(req),
  concurrency: 100,
})

// Prod: strict limit
const ApiGateProd = RunResource.layer(ApiGate, {
  effect: (req) => httpFetch(req),
  concurrency: 10,
})

const gate = yield* ApiGate
yield* gate.run(request)
```

When `ProcessStorage.layer` or `RunResource.store(tag)` is composed, the engine automatically
persists run facts and state transitions (same optional semantics as `QueueResource`).

#### Raw make (no tag)

```typescript
const gate = yield* RunResource.make({
  name: "@app/Multiplier",
  effect: (n: number) => Effect.succeed(n * 2),
  concurrency: 3,
})
const result = yield* gate.run(21)  // 42
```

### Live observation (Tag / Service / layer)

Toolkit services expose **`Subscribable`** views backed by `SubscriptionRef`:

```typescript
const gate = yield* ApiGate
yield* gate.run(request)

const waiting = yield* gate.waiting.get
yield* Stream.runForEach(gate.completed.changes, (n) =>
  Effect.log(`completed: ${String(n)}`),
)
```

Static shortcuts: `yield* ApiGate.run(request)` (requires the tag in `R`).

### Remote (RPC)

Same tag + config as {@link layer}; serve over HTTP like Queue/Process:

```typescript
const remoteHandlers = RunResource.serveRemote(ApiGate, {
  effect: (req) => httpFetch(req),
  concurrency: 10,
})

const localAndRemote = RunResource.serve(ApiGate, { effect: (req) => httpFetch(req) })
```

Wire schemas on the tag: `runGateStatus`, `runSpec(payload, success, error?)`.

### Store registration (`RunResource.store`)

Register built-in run facts + state history on an app {@link Store.Service}:

```typescript
class AppStore extends Store.Service<AppStore>("@app/Store")(
  RunResource.store(ApiGate),
) {}

// Engine auto-writes when AppStore.layerMemory (or .layer) is composed with ApiGate.layer
const store = yield* AppStore.at(ApiGate)
const facts = yield* store.facts()
```

Legacy **`RunResourceStore`** / **`ProcessStorage.layer`** path persists the same events via static emitters.

---

## HttpApiResource

Typed HTTP API client with transport-level concurrency gating.

### Construction patterns

#### Basic (most common)

```typescript
import { HttpApi, HttpApiGroup, HttpApiEndpoint } from "effect/unstable/httpapi"
import { Schema } from "effect"
import { HttpApiResource } from "@nikscripts/effect-pm"

// Define your API schema
const getUser = HttpApiEndpoint.get("getUser", "/users/:id", {
  success: Schema.Struct({ name: Schema.String, email: Schema.String }),
})
const UsersApi = HttpApi.make("users-api")
  .add(HttpApiGroup.make("users").add(getUser))

// Create gated client
const UsersClient = HttpApiResource.make(UsersApi, {
  name: "@app/UsersClient",
  baseUrl: "https://api.example.com",
  concurrency: 5,
})

// Use in program
const client = yield* UsersClient
const user = yield* client.users.getUser({ path: { id: "123" } })
```

#### With auth header (transformClient)

```typescript
const AuthClient = HttpApiResource.make(MyApi, {
  name: "@app/AuthClient",
  baseUrl: "https://api.example.com",
  concurrency: 10,
  transformClient: (client) =>
    HttpClient.mapRequest(client,
      HttpClientRequest.setHeader("Authorization", `Bearer ${token}`),
    ),
})
```

#### With Accept: application/json

```typescript
import { acceptJson } from "@nikscripts/effect-pm"

const JsonClient = HttpApiResource.make(MyApi, {
  name: "@app/JsonClient",
  baseUrl: "https://api.example.com",
  transformClient: acceptJson,  // adds Accept: application/json to all requests
})
```

#### No concurrency limit (pass-through)

```typescript
const UnlimitedClient = HttpApiResource.make(MyApi, {
  name: "@app/UnlimitedClient",
  baseUrl: "https://api.example.com",
  // no concurrency field — requests are not gated
})
```

#### Wrapping an existing client effect (layerEffect)

```typescript
import { Context } from "effect"

// You already have a custom client builder
const myCustomMake = Effect.gen(function*() {
  return yield* HttpApiClient.make(MyApi, { baseUrl: "...", transformClient: acceptJson })
})

type ClientShape = Effect.Success<typeof myCustomMake>
class MyClient extends Context.Service<MyClient, ClientShape>()("@app/MyClient") {}

// Wrap with concurrency gate
const MyClientLive = HttpApiResource.layerEffect(MyClient, myCustomMake, {
  concurrency: 10,
})
```

---

## Readiness

Any resource can report **readiness** — whether it's actually able to serve, beyond merely being up. A host aggregates its resources' readiness into one result with two faces (SSOT): the plain `GET /health` route (`200` ok / `503` degraded) and `HostStatus` (the dashboard health board).

`Readiness` is `{ ready: boolean; detail?: string }`. Attach a derivation with **`Resource.withReadiness`** — dual, so it reads naturally in a class `extends`:

```ts
class EdgeCache extends Resource.Tag<EdgeCache>()("edge/Cache", {
  warm: Resource.effect(Schema.Boolean),
}).pipe(
  Resource.withReadiness((svc) =>
    Effect.map(svc.warm, (warm) => (warm ? { ready: true } : { ready: false, detail: "cold" })),
  ),
) {}
```

Derivations **stack**: a later `withReadiness` receives the previous one as a second arg, `base`, so you extend a contract's built-in check (e.g. a queue's `phase === "running"`) instead of replacing it.

**Depend on another resource.** `Resource.readinessOf(tag)` yields a resource's service and runs *its* derivation; `Resource.allReady([...])` combines checks with AND (first not-ready wins). So a queue can report degraded when a dependency (e.g. a `Database` resource) is down — compile-time-checked (the dependency lands in the readiness Effect's requirements), and it works whether the dependency is local or reached over RPC:

```ts
class Jobs extends QueueResource.Tag<Jobs>()("app/Jobs", Item, { host: AppHost }).pipe(
  Resource.withReadiness((_svc, base) =>
    Resource.allReady([base, Resource.readinessOf(Database)]),
  ),
) {}
```

`Resource.readinessCheck(tag, service)` runs a tag's derivation (a tag with none is **ready by default**); `httpServer` calls it to build the host aggregate.

On the dashboard, the host **health board** (tap the host die) lists degraded resources across every host with their root cause, and each resource's own detail page shows a `degraded — <root cause>` banner (`ResourceReadinessBanner`).

> Acquisition vs. readiness: get hard dependencies ready by acquiring them eagerly with `Layer.scoped` (failures surface at boot); readiness covers the *runtime* health `Layer` can't see (a connection that drops after boot).

---

## Serving custom resources (`serve` / `serveRemote` / `httpServer`)

`Resource.httpServer([...serve-layers], options?)` serves **many** resources on **one** host/port (one `/rpc` + the auto-mounted `/health` + `HostStatus`); a client reaches each via `Resource.client(Tag)` over one `connectHttp` transport. Each layer carries **its own** requirement `R`, and `httpServer` **unions** them (a queue's worker `R`, an `ApiMetrics` `Scope`, a plain resource's `never`) — no per-entry cast — while exposing the union of every layer's grants.

Build each layer with **`serve`** (local **and** served — the default) or **`serveRemote`** (served-only, a pure gateway):

- **`Resource.serve(tag, impl)`** / **`Resource.serveRemote(tag, impl)`** — for a **raw** `Resource.Tag`. Both **spec-check** the impl against the tag's spec (a bare `{ tag, impl }` literal is typed `Record<string, unknown>` and silently accepts typos). `serve` additionally grants `Self | LocalCapability<Self>` from the **same** materialization, so the serving node also `yield*`s the resource in-process; `serveRemote` mounts wire handlers only. Two impl forms: a plain **record** (`R = never`) or an **`Effect`** that builds it carrying a requirement `R`.
- **`QueueResource.serve(tag, config)`** / **`Process.serve(tag, config)`** / **`ApiMetrics.serve(tag)`** — the **engine** forms: same grant + registration, but the served layer also **runs the engine** (worker / refill / `persist` for queues, tick schedule for processes) with the worker/tick `R` preserved. Use these for queue/process tags — `Resource.serve` only mounts handlers and would leave the worker/tick dead. Each has a matching `serveRemote` for served-only nodes.

```ts
Resource.httpServer([
  QueueResource.serve(RosterQueue, { effect }),        // worker R
  ApiMetrics.serve(SdpApi),                            // Scope
  Resource.serve(Database, { status: pingStatus }),    // raw, spec-checked
]).pipe(Layer.provideMerge(NodeHttpServer.layer({ port: 3001 })));
```

> `Resource.instance` is **not** for this — it builds a `ResourceInstance` for the `serveInstances` family (one factory, many keyed instances). To serve one custom resource, pass its `serve` layer to `httpServer`.

### Per-resource dependencies

Because each `serve` layer carries **its own** `Layer.provide`, resources on one host that need **different implementations of the same tag** (mutually exclusive — e.g. one worker fires post-persist hooks, another must not) stay isolated — no shared union-provide can confuse them. Resources that **share** a dependency memoize one instance (same `dependency` value → one build; `Layer.fresh(dependency)` to isolate).

- **`Resource.httpServer(serves, options?)`** — reads the `ServedResources` registry, merges every `serve`d group onto **one** `RpcServer` (`/rpc`) + a `/health` route aggregating readiness. Pass the `serve` layers as the first arg (recommended) and it **bundles** the `provideMerge` + `servedResourcesLayer` — you provide only the platform (+ any shared dependency). The low-level `httpServer(options)` form still exists (then you `provideMerge` the `serve` layers, not `provide`, + `servedResourcesLayer` yourself).
- **`Resource.servedResourcesLayer`** / **`Resource.ServedResources`** — the `Ref`-backed registry `serve` appends to and `httpServer` reads.
- **`Resource.provide(dependency, [resources])`** — sugar for `Layer.mergeAll(resources).pipe(Layer.provide(dependency))` — "these resources, on this dependency."

```ts
Resource.httpServer([
  Resource.provide(importHandlers, [                          // a group sharing one dependency
    Resource.serve(SeasonMatches,   seasonMatchesImpl),
    Resource.serve(LiveScorePoller, pollerImpl),
  ]),
  Resource.serve(SeasonImport, importImpl).pipe(Layer.provide(hookedImport)), // its own — isolated
], { health: { path: "/health" } }).pipe(
  Layer.provide(NodeHttpServer.layer(() => createServer(), { port })),
);
```

The tick/worker body just **declares** its dependency (`const h = yield* ImportHandlers`) — no `Effect.provide`, so `strictEffectProvide: "error"` stays clean. A missing handler fails the `RpcServer` at **boot**, never silently.

---

## Multi-host resources (one shape, N instances)

One resource served as **N instances**, one per host (`Database` on three league hosts). Combined/fleet values are **plain queries** you tag with `Resource.fleet` and implement in the layer by folding `Resource.peers` + your own value — no special field kind.

```ts
import { Combine, combineQuery } from "@nikscripts/effect-pm/MultiHost";

// hosts carry their own url; pipe the fleet on with `multiHost([...])` (hostless — every instance an
// equal peer, no primary host).
class NwslHost extends Resource.Host<NwslHost>("nwsl", { url: nwslUrl }) {}
class Database extends Resource.Tag<Database>()("app/Database", {
  connections:      Resource.effect(Schema.Number),                 // per-instance ("leaf")
  totalConnections: Resource.effect(Schema.Number).pipe(Resource.fleet), // combined across the fleet
}).pipe(Resource.multiHost([NwslHost, EbwslHost, WnbaHost])) {}

// the layer, Effect form (`Resource.layer` also takes an `Effect` that builds the impl): resolve
// `peers` once, then `totalConnections` folds them + this host's own value.
const database = Resource.layer(
  Database,
  Effect.gen(function* () {
    const peers = yield* Resource.peers(Database); // the other hosts' leaf clients (keyed by host)
    return {
      connections: Effect.sync(() => pool.activeCount()),
      totalConnections: combineQuery(peers, (p) => p.connections, Combine.sum).pipe(
        Effect.map((others) => pool.activeCount() + others),
      ),
    };
  }),
);

// serve on each host: the layer + `peersLayer` (the opt-in mesh — only where a host reaches its peers)
Resource.httpServer([Resource.serve(Database, database)]).pipe(
  Layer.provide(Resource.peersLayer(Database, NwslHost)),
);
```

- **`Resource.fleet(method)`** (or `query(...).pipe(Resource.fleet)`) — a combined field: served + client-visible like any query, but **excluded from `Resource.peers`**, so a fold can't call a peer's own fleet field (a fan-out). Fold over **leaf** fields.
- **`Resource.peers(tag)`** — the other hosts' leaf clients, keyed by host. Fold with `/MultiHost`'s `combineQuery`/`combineStream` + `Combine` (`sum`/`byHost`/`mergeStreams`/`mergeByHost`/…). Requires the peers capability, provided by **`Resource.peersLayer(tag, self)`** (connects the `multiHost` set minus self) or **`Resource.peersFrom(tag, clients)`** (an explicit client map — a holder's bundles, or a test). Peer urls default to each `Host.url` (the standard — the host carries how to reach it); pass **`peersLayer(tag, self, { url: (host) => Effect<string | undefined> })`** to override per host (env-specific ports, tunnels, Effect `Config`), falling back to `Host.url`. A host with no url from either source is skipped — a partial mesh, never a throw.
- **`Resource.selfHost(tag)`** — the host key this instance runs as, the **same key** its peers are keyed by. For `Combine.byHost` folds (one row per host), so the impl keys its **own** row without hand-threading: `return { ...byHost, [yield* Resource.selfHost(tag)]: ownValue }`. Provided by `peersLayer` (bundled) or standalone **`Resource.selfHostLayer(tag, self)`** (with `peersFrom`, or when a resource keys per host without a mesh).
- **`Resource.fleetHealth(tag, pick, own)`** — the canned droplet-health fold: `pick` a leaf from every peer, key it **by host**, and add this host's `own` value keyed by `selfHost`. `fleetStatus: Resource.fleetHealth(FleetDatabase, (p) => p.status, ownStatus)`. A down peer is skipped (captured, not thrown); the only error/requirement is `own`'s. Sugar over `peers` + `selfHost` + `combineQuery(…, Combine.byHost)`.
- **`Resource.layer(tag, effect)`** — the Effect form: build the impl effectfully; its requirement (e.g. `peers`) becomes the layer's, discharged by providing `peersLayer` alongside. `Resource.serve` has the same Effect form (`httpServer` unions the requirement).
- **`Resource.client(tag, host)`** — a hostless multi-host tag is N instances, so the client names *which* one: `Resource.client(FleetDatabase, NwslHost).pipe(Layer.provide(connectHttp(NwslHost)))`. The transport resolves from that host, so the layer requires the host (satisfied by `connectHttp`) — enforced at compile time, so there's no runtime "Service not found" for a hostless client. (Host-bound tags still use the one-arg `Resource.client(tag)`.)
- A **client calling a fleet field on any host** gets the whole-fleet value — that host gathered its peers + itself. No cross-host hop at `/health`; readiness stays per-host.

The **combine primitives** (`@nikscripts/effect-pm/MultiHost`) are isomorphic (browser + node): `combineQuery`/`combineStream` capture each host's outcome (`HostResult`), so a fold owns the down-host policy.

---

## ProcessStorage Integration

Resource modules automatically record runtime facts when the relevant storage facet is available in the environment. No configuration is needed beyond composing `ProcessStorage.layer` or a durable storage layer.

```typescript
import { ProcessStorage } from "@nikscripts/effect-pm"

// Without storage — resources work fine, no analytics
program.pipe(Effect.provide(EmailQueue.layer))

// With storage — queue/run records are written automatically
program.pipe(
  Effect.provide(Layer.mergeAll(
    EmailQueue.layer,
    ProcessStorage.layer,  // just by being here, records activate
  ))
)
```

Records written by `QueueResource`:
- `queue.entry.enqueued` — entry id, dedupe key, priority, attempt count, enqueue timestamp
- `queue.entry.started` — entry id, dedupe key, priority, attempt count, start timestamp
- `queue.entry.completed` / `queue.entry.failed` — duration, attempts, error when present
- `queue.entry.retried` / `queue.entry.exhausted` — retry lifecycle
- `queue.lifecycle.started|paused|resumed|shutdown|cleared|drained`

Query queue records through the queue storage facet:

```typescript
import { QueueResourceStore } from "@nikscripts/effect-pm/store/QueueResource"

const queueStore = yield* QueueResourceStore
const entries = yield* queueStore.entries("email-queue")
const byKey = yield* queueStore.entriesByKey("delivery-123")
```

`queue.release()` exports decoded pending entries without losing payloads,
unlike `queue.clear()`. This local release path does not require `itemSchema`.
`queue.releaseEncoded()` is for remote/wire handoff and requires `itemSchema`;
it returns JSON-compatible payloads and fails with structured encoding errors
instead of exporting incompatible data. This first release mode is pending-only:
in-flight work stays on the source queue. `queue.drop(...)` and
`queue.deadLetter(...)` remove matching pending entries and trigger their
lifecycle hooks.
