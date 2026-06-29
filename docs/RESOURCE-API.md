# Resource API Reference

Complete guide to `QueueResource`, `CustomQueueResource`, `RunResource`, and `HttpApiResource` — the managed resource modules in `@nikscripts/effect-pm`.

---

## Resource kinds

Every contract's `.Tag` factory stamps a canonical **kind** id on the tag it builds, so consumers can classify a tag by *what it is* rather than sniffing its spec members (which is fragile — e.g. a queue and an `ApiMetrics` tap both expose a `metrics` stream).

```ts
import * as Resource from "@nikscripts/effect-pm/Resource";
import * as QueueResource from "@nikscripts/effect-pm/QueueContract";

Resource.kindOf(MyQueue);        // "@nikscripts/effect-pm/QueueResource"
Resource.kindOf(MyQueue) === QueueResource.kind; // true
Resource.kindOf(SomePlainTag);   // undefined  (a bare Resource.Tag carries no kind)
```

`Resource.kindOf(tag)` accepts `unknown` (so a `Group` member passes straight in) and returns the kind id or `undefined`. Each contract exports its id as `kind`:

| Contract | `kind` |
| --- | --- |
| `QueueResource` (`…/QueueContract`) | `@nikscripts/effect-pm/QueueResource` |
| `ScheduledProcess` | `@nikscripts/effect-pm/ScheduledProcess` |
| `CustomQueueResource` (`…/CustomQueueContract`) | `@nikscripts/effect-pm/CustomQueueResource` |
| `ProcessScheduleResource` (`…/ProcessScheduleContract`) | `@nikscripts/effect-pm/ProcessScheduleResource` |
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
import * as CustomQueueResource from "@nikscripts/effect-pm/CustomQueueContract"
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

Subpaths: `@nikscripts/effect-pm/CustomQueueResource` (namespace + engine), `@nikscripts/effect-pm/CustomQueueContract` (tag/layer/server only).

Example: [`examples/forms/queue/custom-queue-resource-n-level.ts`](../examples/forms/queue/custom-queue-resource-n-level.ts) (`pnpm run example:custom-queue-resource`).

---

## RunResource

Concurrency gate (semaphore) around any effect. No queues, no workers — just bounded parallelism.

### Construction patterns

#### Class declaration (parameterized gate)

```typescript
class SendSms extends RunResource.Service<SendSms, PhoneNumber, SmsResult, SmsError>()(
  "@app/SendSms",
  {
    effect: (phone) => twilioClient.send(phone),
    concurrency: 5,
  },
) {}

const send = yield* SendSms
const result = yield* send("+1234567890")
```

#### Class declaration (unit gate — no input)

```typescript
class RefreshPrices extends RunResource.Service<RefreshPrices, void, PriceData, FetchError>()(
  "@app/RefreshPrices",
  {
    effect: () => fetchLatestPrices(),
    concurrency: 1,  // only one refresh at a time
  },
) {}

const refresh = yield* RefreshPrices
const prices = yield* refresh(undefined)
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
class ApiGate extends RunResource.Tag<ApiGate, Request, Response, ApiError>()(
  "@app/ApiGate",
) {}

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
```

#### Raw make (no tag)

```typescript
const gate = yield* RunResource.make({
  effect: (n: number) => Effect.succeed(n * 2),
  concurrency: 3,
})
const result = yield* gate(21)  // 42
```

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
