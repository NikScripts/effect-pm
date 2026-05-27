# QueueResource

A **queue** is a managed three-level priority worker pool (`high`, `normal`, `low`) in effect-pm. You provide an **`effect`** that processes one item per invocation; the runtime handles concurrency, deduplication, retry via hooks, pause/resume, and optional schema validation on enqueue. When **`ProcessStore`** is in the environment, item and lifecycle events are recorded for status and control surfaces.

**Scope of this guide:** how to **define** queues and wire configuration. Queues are typically declared with **`QueueResource.Service`** (or **`Tag` + `layer`**) and registered on a **`ProcessGroup`** so **`group.start`**, **`group.queue(…).enqueue`**, and remote controls share one contract. **`QueueResource.make`** remains available for scoped tests and low-level composition inside a `Scope`.

This guide is separate from [`docs/RESOURCE-API.md`](../RESOURCE-API.md) (operation tables and hook envelopes).

---

## Ways to define a queue

The queue **id** is the service **name** string (for example `"@app/EmailQueue"`). For **`Service`** and **`layer`**, pass the worker **`effect`** as the second argument and everything else as a third **options** object (`QueueResourceOptions*`, config minus `effect`). A full **config object** (with `effect` inside) remains supported for large hook blocks and **`itemSchema`**.

### `QueueResource.Service<Self, T, E>()(id, effect, options?)`

Returns a **`Context.Service`** subclass with `id`, `kind: "queue"`, `tag`, baked **`layer`**, and optional **`item`** codec metadata when **`itemSchema`** is set. **Preferred for typed `ProcessGroup` entries and production apps.**

```typescript
import { Effect, Exit } from "effect";
import { QueueResource } from "@nikscripts/effect-pm";

class EmailQueue extends QueueResource.Service<EmailQueue, Email, SmtpError>()(
  "@app/EmailQueue",
  (email) => sendEmail(email).pipe(Effect.asVoid),
  {
    onExit: ({ exit, retry }) =>
      Exit.match(exit, {
        onFailure: () => retry,
        onSuccess: () => Effect.void,
      }),
    concurrency: 10,
    retries: 3,
  },
) {}
```

For many hooks or **`itemSchema`**, use the config-object overload: `(id, { effect, … })` — same runtime as positional args.

**Benefits**

- Typed **`ProcessGroup.make(id, [EmailQueue, …] as const)`** and contract discovery (`item` schema when configured).
- One import site: **`EmailQueue.layer`** at the app or group root.
- **`yield* EmailQueue`** for the live **`QueueHandle`** inside programs that already provide the layer.
- **`.configure` / `.wrapWorker`** — layer patches folded before runtime; see [resource-configure.md](./resource-configure.md).

**Tradeoffs**

- Class boilerplate vs a one-off scoped queue.

---

### `QueueResource.Tag<Self, T, E, R>()(id)` + `QueueResource.layer(tag, effect, options?)`

**Tag** is identity only (no default implementation). **`layer`** supplies the worker — use when dev/staging/prod implementations differ.

```typescript
class NotificationQueue extends QueueResource.Tag<
  NotificationQueue,
  Notification,
  never,
  never
>()("@app/NotificationQueue") {}

const NotificationQueueLive = QueueResource.layer(
  NotificationQueue,
  (n) => pushService.send(n).pipe(Effect.asVoid),
  { concurrency: 20 },
);
```

**Benefits**

- Dependency inversion and environment-specific layers.
- Same tag type across packages; swap **`layer`** at the composition root.

---

### `QueueResource.make(effect, options?)` or `make(config)`

Scoped **`Effect`** that acquires a **`QueueHandle`** for the current **`Scope`**. Workers are tied to scope lifetime (interrupt on scope close).

```typescript
import { Effect } from "effect";
import { QueueResource } from "@nikscripts/effect-pm";

// Inside Effect.scoped — tests, custom Layer builders
const queue = yield* QueueResource.make(
  (item: string) => Effect.logInfo(item),
  { name: "temp-work", concurrency: 5 },
);
```

**Benefits**

- No Context tag; minimal surface for tests and `Layer.effect(tag)(QueueResource.make(…))`.

**Tradeoffs**

- Requires **`Scope`**; not a `ProcessGroup` contract entry by itself.
- Caller must **`provide`** worker dependencies in the enclosing environment.

---

## Choosing a form

| Goal | Prefer |
| --- | --- |
| Typed **`ProcessGroup`** entry | **`QueueResource.Service(id, effect, options?)`** |
| Swappable implementation per env | **`Tag` + `layer(tag, effect, options?)`** |
| Scoped test or custom `Layer` | **`make(effect, options?)`** |
| Many hooks or `itemSchema` in one literal | Config-object overload on **`Service`** / **`layer`** / **`make`** |
| Production default | **`Service`** with positional effect + options |

---

## Registering on a group

Typed groups list **queue service classes** next to processes:

```typescript
import { ProcessGroup } from "@nikscripts/effect-pm";

const group = yield* ProcessGroup.make("@app/Billing", [
  SyncProcess,
  EmailQueue,
] as const);

// Enqueue via typed controls (in-process)
yield* group.queue(EmailQueue).enqueue({ to: "ops@example.com" });

// Or yield* EmailQueue when the layer is in scope
```

**`autoStart: false`** — workers are not forked until **`yield* queue.start`** or **`group.start(EmailQueue)`** (group start includes queue worker startup for deferred queues). See group tests for **`onDrained`** coordination with **`startAll`**.

Remote **`ProcessManager`** exposes queue **lifecycle** controls (`start`, `pause`, `resume`, `clear`, `status`); **enqueue** remains in-process on the typed/local handle today.

---

## Configuration (`QueueResourceConfig`)

### Base fields (`QueueResourceConfigBase`)

| Field | Default | Role |
| --- | --- | --- |
| `name` | `"anonymous"` | Logs and error messages (overridden by service id when using **`Service`**). |
| `effect` | — | **Required.** `(item, ctx) => Effect<void, E, R>` — processes one item. |
| `concurrency` | `5` | Worker count. |
| `capacity` | `50_000` | Max pending items **per priority** level. |
| `paused` | `false` | Start with workers blocked until **`resume`**. |
| `autoStart` | `true` | When `false`, call **`queue.start`** (or group start) to fork workers. |
| `key` | — | Dedup key; drops items already in-flight with the same key. |
| `retries` | `Infinity` | Cap on hook-driven **`event.retry`** re-enqueues. |

### Optional `itemSchema`

When set, public enqueue paths and hook **`ctx.add`** / **`prioritize`** / **`defer`** can fail with **`QueueItemValidationError`** / **`QueueBatchValidationError`**. **`releaseEncoded`** requires a schema for wire handoff.

### Lifecycle hooks (all optional)

Fire-and-forget; receive **`QueueControls`** (same surface as **`QueueHandle`** for enqueue and lifecycle).

| Hook | When |
| --- | --- |
| `onEnqueued` | After a batch is accepted |
| `onStart` | Worker pool starts |
| `onStarted` | Item begins processing |
| `onExit` | Item worker finished ( **`retry`** available ) |
| `onCompleted` | Success path |
| `onFailed` | Failure path ( **`retry`** available ) |
| `onRetryScheduled` | Before re-enqueue |
| `onRetryExhausted` | Retries exhausted |
| `onDrained` | Pending queues empty after work or **`clear`** (not cold-start idle) |
| `onCleared` | After **`clear`** |
| `onReleased` | After **`release`** |
| `onDeadLettered` | After **`deadLetter`** |
| `onDropped` | After **`drop`** |

---

## Worker `EffectContext`

Passed as the second argument to **`effect`**:

| Field / method | Role |
| --- | --- |
| `attempts` | 1-based try count |
| `enqueuedAt` | Epoch ms when first enqueued |
| `priority` | `"high"` \| `"normal"` \| `"low"` |
| `add` / `prioritize` / `defer` | Enqueue derived work (self-enqueue by ref/key is guarded and dropped) |

---

## Handle API (`QueueHandle<T, E, EEnqueue, R>`)

**Enqueue** (iterable batch, same item type):

- **`add`** / **`enqueue`** — normal priority  
- **`prioritize`** — high priority (processed first)  
- **`defer`** — low priority  

**Observe** (Effect properties — no call parentheses):

- **`size`**, **`sizes`**, **`isEmpty`**, **`completed`**

**Lifecycle**

- **`start`** — fork workers when **`autoStart: false`**
- **`pause`** / **`resume`**
- **`shutdown`** — permanent; further enqueue dropped (warned)
- **`clear`** — drain pending, reset completed counter
- **`release`** / **`releaseEncoded`** — export pending for handoff
- **`drop`** / **`deadLetter`** — remove pending by selector

Provide worker **`R`** (SMTP client, DB, etc.) in the layer environment merged at the app or group root.

---

## Types

| Symbol | Meaning |
| --- | --- |
| `QueueHandle<T, E, EEnqueue, R>` | Live queue surface (`R` last = worker deps). |
| `QueueResourceConfig<T, E, R>` | Config with or without schema. |
| `QueueResourceOptionsWithoutItemSchema<T, E, R>` | Positional options (no `effect`, no schema). |
| `QueueResourceOptionsWithItemSchema<T, E, R>` | Positional options including `itemSchema`. |
| `QueueWorkerEffect<T, E, EEnqueue, R>` | Worker callback type. |
| `QueueConfigFromEffect<F, O>` | Inferred merged config from positional args. |
| `QueueEntry<T>` | Item + metadata for hooks and routing. |
| `QueueResourceDefinition` / `QueueResourceServiceDefinition` | Group contract metadata. |
| `QueueEnqueueErrors` | Validation errors when schema is set. |
| `Priority` | `"high"` \| `"normal"` \| `"low"` |

---

## Related tools

| Tool | Role |
| --- | --- |
| **`ProcessGroup`** | Registers queues; typed **`queue()`** controls. |
| **`ProcessStore`** | Item completed + lifecycle events. |
| **`ProcessManager`** | Remote lifecycle/status (not remote enqueue). |
| **`ControlService`** | Local HTTP routes for group controls. |
| **`RunResource`** / **`HttpApiResource`** | Concurrency gates for HTTP (not queue throttle). |

---

## Implementation reference

| Location | Contents |
| --- | --- |
| `src/QueueResource.ts` | `make`, `Service`, `Tag`, `layer`, workers |
| `src/ProcessStore.ts` | Queue event recording |
| `src/ProcessGroup.ts` | Typed queue controls |

See also [process-group.md](./process-group.md), [process-manager.md](./process-manager.md), [control-plane.md](./control-plane.md).

---

## Planned: tagged `onEvent` hooks

Today each lifecycle point is a **separate optional callback** on config (`onExit`, `onFailed`, `onDrained`, …) with **different event structs**. That matches the runtime but scatters control flow across many fields.

A possible future API is a **single hook** over a discriminated union with `_tag`, handled with Effect **`Match.tag`** so each branch narrows to the right payload (e.g. `retry` only on `Failed` / `Exit`, `entries` only on `Released`):

```typescript
// Illustrative — not implemented
type QueueEvent<T, E, R> =
  | { readonly _tag: "Exit"; readonly event: QueueExitEvent<T, E, R> }
  | { readonly _tag: "Failed"; readonly event: QueueFailedEvent<T, E, R> }
  | { readonly _tag: "Drained"; readonly event: QueueDrainedEvent }
  // …

onEvent: (event, queue) =>
  Match.value(event).pipe(
    Match.tag("Failed", ({ event }) => event.retry),
    Match.tag("Drained", ({ event }) => seedWhenEmpty(event.completed)),
    Match.exhaustive,
  ),
```

**Why consider it:** exhaustive handling, one place for metrics/logging, Effect-idiomatic pattern matching. **Why not rush it:** existing per-hook config stays clear for small queues. Declarative **`retry: { times }` / `Schedule`** could land alongside or before `onEvent`.
