# Resource API Reference

Complete guide to `QueueResource`, `RunResource`, and `HttpApiResource` — the managed resource modules in `@nikscripts/effect-pm`.

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
    handler: (item, exit, ctx) =>
      Exit.match(exit, {
        onFailure: () => ctx.retry,
        onSuccess: () => Effect.void,
      }),
    concurrency: 10,
    capacity: 100_000,
    retries: 3,
    onRetryExhausted: (item) => deadLetterQueue.add([item]),
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
```

### Configuration reference

```typescript
QueueResource.Service<Self, T, E>()("name", {
  // ─── Required ───
  effect: (item: T, ctx: EffectContext<T>) => Effect<R, E>,

  // ─── Handler (forked, never blocks workers) ───
  handler: (item: T, exit: Exit<R, E>, ctx: HandlerContext<T>) => Effect<void>,

  // ─── Concurrency ───
  concurrency: 5,        // worker count (default: 5)
  capacity: 50_000,      // max items per priority queue (default: 50,000)
  paused: false,         // start paused? (default: false)
  autoStart: true,       // fork workers at acquisition (default: true); false → call `yield* queue.start`

  // ─── Deduplication ───
  key: (item) => item.id, // extract dedup key; duplicates silently dropped

  // ─── Retry (handler-driven) ───
  retries: 3,             // max re-enqueues via ctx.retry
  onRetryExhausted: (item, cause) => ...,  // called when limit reached

  // ─── Hooks (fire-and-forget) ───
  onEnqueue: (items, priority) => metrics.increment("enqueued", items.length),
  onComplete: (item, exit, elapsed) => metrics.record("duration", elapsed),
  onStart: (queue) => queue.add(seedItems),
  onDrained: (queue) => queue.add(fetchMoreWork),
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

### HandlerContext (passed to `handler`)

```typescript
handler: (item, exit, ctx) => Effect.gen(function*() {
  // ─── Same metadata ───
  ctx.attempts   // number
  ctx.enqueuedAt // number (epoch millis)
  ctx.priority   // "high" | "normal" | "low"

  // ─── Retry: re-enqueue at same priority (back of line) ───
  yield* ctx.retry  // respects retries limit

  // ─── Enqueue (unguarded — handler is trusted) ───
  yield* ctx.add([newItem])
  yield* ctx.prioritize([escalated])
  yield* ctx.defer([demoted])
})
```

### Patterns

#### Error handling with retry + dead letter

```typescript
class OrderQueue extends QueueResource.Service<OrderQueue, Order, OrderError>()(
  "@app/OrderQueue",
  {
    effect: (order) => processOrder(order),
    handler: (item, exit, ctx) =>
      Exit.match(exit, {
        onFailure: () =>
          ctx.attempts < 3
            ? ctx.retry
            : ctx.defer([item]),  // demote to low priority after 3 fails
        onSuccess: () => Effect.void,
      }),
    retries: 5,
    onRetryExhausted: (item) => Effect.logError(`Order ${item.id} permanently failed`),
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

## ProcessStore Integration

Resource modules automatically record runtime facts to `ProcessStore` when it's available in the environment. No configuration needed.

```typescript
import { ProcessStore } from "@nikscripts/effect-pm"

// Without ProcessStore — resources work fine, no analytics
program.pipe(Effect.provide(EmailQueue.layer))

// With ProcessStore — queue/run records are written automatically
program.pipe(
  Effect.provide(Layer.mergeAll(
    EmailQueue.layer,
    ProcessStore.layer,  // just by being here, records activate
  ))
)
```

Records written by `QueueResource`:
- `queue.entry.enqueued` — entry id, dedupe key, priority, attempt count, enqueue timestamp
- `queue.entry.started` — entry id, dedupe key, priority, attempt count, start timestamp
- `queue.entry.completed` / `queue.entry.failed` — duration, attempts, error when present
- `queue.entry.retried` / `queue.entry.exhausted` — retry lifecycle
- `queue.lifecycle.started|paused|resumed|shutdown|cleared|drained`

Query queue records through the semantic `ProcessStore.QueueResource` helpers:

```typescript
const entries = yield* ProcessStore.QueueResource.entries("email-queue")
const byKey = yield* ProcessStore.QueueResource.entriesByKey("delivery-123")
```
