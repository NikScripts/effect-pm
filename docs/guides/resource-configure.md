# Resource configure (layer patches)

Override **defaults** on `Process.Service`, `QueueResource.Service`, and `RunResource.Service` with **`Layer` patches** — not hot reload. Patches fold **once** when the resource `.layer` is built.

**API:** `configureLayer`, `foldConfig`, `ConfigPatch` from `@nikscripts/effect-pm`. Per-service: `.configure`, `.wrapWorker` / `.wrapEffect` / `.wrapGate`, `.defaultSpec`.

---

## Model

| Piece | Role |
| --- | --- |
| `defaultSpec` | Factory config before any patch |
| `.configure(patch)` | Append one `ConfigPatch` (partial, `effect` updater, or full reducer) |
| `.wrapWorker` / `.wrapEffect` / `.wrapGate` | Shorthand: replace only `effect` via `fn(previous) => next` |
| Resource `.layer` | `foldConfiguredSpec(id, defaultSpec)` then build runtime |

**Not supported:** changing config after the queue/process/gate is running. Provide a new layer stack and rebuild.

**Layer order:** standard `Layer.provide` / `Layer.provideMerge` — merge configure layers **with** the resource `.layer` so patches are in context when the resource layer acquires.

---

## `ConfigPatch<T>`

1. **Partial** — `{ concurrency: 3 }`, `{ paused: true }`
2. **`effect` in a partial** — unary `(previous) => next` updates the prior worker/supervised body; a **multi-arg function value** replaces `effect` (queue workers stay `(item, ctx) => …`)
3. **Full reducer** — `(spec) => ({ ...spec, … })` via `.configure`

Pure merge helper (tests, custom tooling):

```typescript
import { foldConfig } from "@nikscripts/effect-pm";

const effective = foldConfig(
  { concurrency: 10, label: "a" },
  { concurrency: 3 },
  (prev) => ({ ...prev, label: `${prev.label}-x` }),
);
```

---

## Queue

```typescript
import { Duration, Effect, Layer } from "effect";
import { QueueResource } from "@nikscripts/effect-pm";

class EmailQueue extends QueueResource.Service<EmailQueue, Email, SmtpError>()(
  "@app/EmailQueue",
  (email) => send(email).pipe(Effect.asVoid),
  { concurrency: 10 },
) {}

const EmailQueueConfigured = EmailQueue.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      EmailQueue.configure({ concurrency: 3 }),
      EmailQueue.configure({
        rateLimit: { limit: 100, window: Duration.minutes(1) },
      }),
      EmailQueue.wrapWorker((prev) => (item, ctx) =>
        prev(item, ctx).pipe(Effect.tap(() => audit(item))),
      ),
    ),
  ),
);
```

Patches apply **before** `makeQueueRuntime` (workers, hooks, enqueue validation).

---

## Process

```typescript
import { Effect, Layer } from "effect";
import { Process } from "@nikscripts/effect-pm";

class Sync extends Process.Service<Sync>()("@app/Sync", {
  effect: Effect.log("default"),
}) {}

// provide configure layers where the resource layer is built.
const SyncConfigured = Sync.buildConfiguredProcess.pipe(
  Effect.provide(
    Layer.mergeAll(
      Sync.configure((spec) => ({ ...spec, effect: Effect.log("patched") })),
      // or: Sync.wrapEffect((prev) => Effect.log("patched")),
    ),
  ),
);
```

`buildConfiguredProcess` resolves the folded spec when the resource runtime is created.

---

## Run gate

```typescript
const SendSms = RunResource.Service<SendSms>()("@app/Sms", {
  payload: PhoneSchema,
  success: Schema.Void,
  error: SmsErrorSchema,
  effect: (phone) => send(phone),
  concurrency: 5,
});

const SendSmsLive = SendSms.layer.pipe(
  Layer.provideMerge(SendSms.configure({ concurrency: 2 })),
);
```

---

## Tag key

`resourceConfigureTagKey(id)` → `@nikscripts/effect-pm/ResourceConfigure/${id}`. Matches the service **name** / process **id** string.

---

## Related

- [queue-resource.md](./queue-resource.md) — queue definition forms
- [process.md](./process.md) — process definition forms
