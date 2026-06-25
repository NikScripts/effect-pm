# QueueResource (toolkit) — guide

A managed priority queue you drive with `yield* MyQueue`, where **the exact same code runs
local or remote — only the layer you provide changes.** This is the point of the toolkit
port: a queue is a `Resource` tag, so from the program's (and dependency-injection's) point of
view, "a local queue" and "a queue across the network" are *the same dependency*.

> **Why this matters for UI work:** you can build a dashboard / control UI against a **local**
> queue today and ship it remote later **without touching the UI code**. The UI depends on the
> *tag*; whether it's backed by a local engine or a remote RPC client is a layer swap at the
> composition root. So remote-facing UIs don't have to wait for the remote infrastructure —
> develop and test them locally, flip the layer when the server side is ready.

> ⚠️ This is the **toolkit** `QueueResource`, in `src/QueueContract.ts` — distinct from the
> engine `QueueResource` in the root barrel. Import it from the module path explicitly:
> `import { QueueResource } from ".../QueueContract"`. (A public barrel/subpath export is
> pending a naming decision, since the barrel `QueueResource` name is the engine's.)

---

## 1. Define the queue (the shared tag)

```ts
import { Schema } from "effect";
import { QueueResource } from ".../QueueContract";

interface EmailJob {
  readonly id: string;
  readonly to: string;
}
const EmailJobSchema = Schema.Struct({ id: Schema.String, to: Schema.String });

// `Self` is explicit (Effect's two-stage `()()`); item type is inferred from the schema.
class EmailQueue extends QueueResource.Tag<EmailQueue>()("@app/EmailQueue", EmailJobSchema) {}
```

The tag is the single thing you share between the UI, the local layer, and the remote wiring.
That's it — no transport, no impl baked in.

---

## 2. Use it — the code that never changes

This is the consumer (your UI/dashboard/CLI logic). It depends only on the tag:

```ts
import { Effect } from "effect";
import { Resource } from ".../Resource";

const dashboard = Effect.gen(function* () {
  const queue = yield* EmailQueue; // ← same line whether local or remote

  // one-shot reads
  const pending = yield* queue.size;
  const { high, normal, low } = yield* queue.sizes;

  // commands — the item is passed DIRECTLY (the item schema is the rpc payload)
  yield* queue.add({ id: "j1", to: "a@x.com" });
  yield* queue.prioritize({ id: "j2", to: "b@x.com" });
  // …or a batch in one call
  yield* queue.add([{ id: "j3", to: "c@x.com" }, { id: "j4", to: "d@x.com" }]);

  // live streams — render these in the UI
  yield* queue.status.pipe(Stream.runForEach((s) => render(s)), Effect.forkScoped);
  yield* queue.metrics.pipe(Stream.runForEach((m) => renderMetrics(m)), Effect.forkScoped);
  // events: runForEachTagScoped forks into the scope for you — no manual Effect.forkScoped
  yield* queue.events.pipe(
    Resource.runForEachTagScoped({
      Completed: (e) => log(`done ${e.entry.item.id}`),
      Failed: (e) => log(`failed ${e.entry.item.id}`),
    }),
  );
});
```

Nothing here knows or cares where the queue lives.

---

## 3. Provide it **locally** (develop here)

`QueueResource.layer(tag, config)` runs the real engine behind the tag. `config` is the engine
worker config **minus `itemSchema`** (the tag already carries it): `effect`, `concurrency`,
`attempts`, `onFailure`, `rateLimit`, `key`, …

```ts
const EmailQueueLocal = QueueResource.layer(EmailQueue, {
  effect: (job) => sendEmail(job),
  concurrency: 5,
  attempts: 3,
});

dashboard.pipe(Effect.provide(EmailQueueLocal), Effect.scoped);
```

Now `dashboard` runs against a live in-process queue — workers, retries, the events/status/
metrics streams, all real. Build and test the whole UI this way.

---

## 4. Provide it **remotely** (flip the layer later)

When the remote side exists, the UI stays byte-for-byte identical; you swap the layer:

```ts
import { RpcClient } from "effect/unstable/rpc";

// drive the queue over RPC, as if it were local
const EmailQueueRemote = Resource.client(EmailQueue);

dashboard.pipe(
  Effect.provide(EmailQueueRemote),     // ← the only change
  Effect.provide(httpTransportLayer),   // where to connect (see below)
  Effect.scoped,
);
```

**Where to connect** — either bind a host to the tag (ship only the tag) or provide the ambient
protocol:

```ts
// host-on-tag (recommended): the client requires the host, the host carries the URL
class QueueHost extends Resource.Host<QueueHost>("queue-host") {}
class EmailQueue extends QueueResource.Tag<EmailQueue>()("@app/EmailQueue", EmailJobSchema, { host: QueueHost }) {}

const QueueAt = Resource.connectHttp(QueueHost, { url: "http://10.0.0.2:3002/rpc" });
dashboard.pipe(Effect.provide(Resource.client(EmailQueue)), Effect.provide(QueueAt), Effect.scoped);
```

**The DI insight:** `Resource.client(EmailQueue)` and `QueueResource.layer(EmailQueue, …)` both
produce a `Layer` that provides `EmailQueue`. To the program they're interchangeable —
identical output service, identical `yield* EmailQueue`. That's why local-first UI development
works.

> **Serving side (the node that hosts the queue):** `QueueResource.serveHttp(tag, config)` runs
> the live engine behind the tag and exposes it over an http `RpcServer` in one call — just add an
> `HttpServer` (e.g. `NodeHttpServer.layer({ port })`):
>
> ```ts
> const EmailQueueServer = QueueResource.serveHttp(EmailQueue, {
>   effect: (job) => sendEmail(job),
>   concurrency: 5,
> }).pipe(Layer.provideMerge(NodeHttpServer.layer({ port: 3002 })));
> ```
>
> `QueueResource.server(tag, config)` is the transport-agnostic form (mount on any `RpcServer` +
> `Protocol`). Both the client (`Resource.client`) and server sides are now complete — full
> remote queue usage works end-to-end (see `test/queue-remote-http.test.ts`).

---

## 5. The service surface

`yield* MyQueue` gives, identically local or remote:

- **Reads:** `size`, `sizes`, `isEmpty`, `completed`, `statusNow` (one-shot snapshot — the
  `status` stream's element read once, for a non-`--watch` print / first paint)
- **Lifecycle:** `start`, `pause`, `resume`, `shutdown` (graceful — see below), `clear`
- **Enqueue:** `add`, `prioritize`, `defer` (bare item **or a batch** `item[]`, by priority — one
  call enqueues many, no N round trips); `enqueue` (re-inject full `QueueEntry`s — e.g. straight
  off `events`, the handoff round-trip)
- **Routing / handoff:** `release`, `releaseEncoded` (export pending entries; encoded = wire form
  for cross-node handoff), `deadLetter`, `drop`
- **Streams:** `events` (discrete lifecycle facts — tagged union), `status` (current-state
  snapshots), `metrics` (windowed aggregates), `logs` (captured log lines — opt-in, see below)

**Graceful shutdown.** `shutdown` returns immediately after *initiating*: the status snapshot's
**`phase`** goes `running` → `draining` → `off`, and a `ShutdownRequested` then `ShutdownComplete`
event crosses the `events` stream. New enqueues are rejected from `draining` on. In-flight items
always finish; already-queued items are handled by the config's **`shutdownMode`**:
`"drain"` (default) processes them first, `"finishActive"` discards them (emitting a `Dropped`
event). A UI renders the terminal state off `status.phase === "off"`. (Idempotent — calling
`shutdown` twice is a no-op.)

`metrics` latency fields: **`avgWaitMillis`** is **per priority** (`{ high?, normal?, low? }` —
queue wait, enqueue → pickup; a lane is present only if it completed work that window, since wait
depends on each lane's load); **`avgExecutionMillis`** (worker time, pickup → done) and
**`avgTotalMillis`** (end-to-end = wait + execution) are overall. The OTEL mirror is
`queue_wait_duration_ms` (tagged by `priority`), `queue_processing_duration_ms` (execution), and
`queue_total_duration_ms`.

**`logs` — the fourth stream (opt-in).** Off by default. Enable per-queue with the `captureLogs`
config (`true`, or `{ level }` for a source-side threshold). When on, **every** log line emitted by
the queue engine *and* by your worker `effect` is captured — with its **level**, message, cause,
annotations (`queueId`, the worker, and the processing `queue.entryId`) and spans preserved — and
published to `queue.logs` (a sliding, lossy buffer like the other streams). A UI attaching to an
already-running queue gets a **bounded recent tail replayed first** (the last ~100 lines), then live
lines — so late subscribers aren't blind to what just happened (a best-effort log-tail; a few lines
in the subscribe gap may be missed). Capture is **merged** with your existing logger(s), so console
/ process-manager logging is unaffected. The element is the package's structured
`ProcessManagerLogEntry` (re-exported as `queueLogEntry`), so it crosses RPC intact. (The toolkit
layer also names the engine queue after the tag id, so logs and OTEL metrics attribute to the
resource.)

```ts
const EmailQueueLocal = QueueResource.layer(EmailQueue, {
  effect: (job) => sendEmail(job),
  captureLogs: { level: "Info" }, // or `true` for all levels; omit for off
});

yield* queue.logs.pipe(Stream.runForEach((line) => render(line)), Effect.forkScoped);
```

**Not yet built (additive — won't break code written against the above):**
- `enqueueEncoded` — the receive side of handoff (decode encoded entries → enqueue). `releaseEncoded`
  (the send side) exists.

---

## 6. Streams

All three streams are plain Effect `Stream`s. For `events` (a tagged union), dispatch by `_tag`
with the cast-free, per-tag-narrowing helper. Two forms:

- **`runForEachTagScoped`** — **non-blocking**: forks the consumer into the enclosing scope and
  returns the `Fiber`; the fiber is interrupted automatically when the scope closes. This is what
  you want for **live observation** (a UI/dashboard watching `events` in the background while the
  rest of the program runs).
- **`runForEachTag`** — **blocking**: runs the stream to completion in the current fiber. Use it
  when you actually want to *wait* (draining a finite stream, a test, a one-shot pipeline).

```ts
// live observation — forks for you, no manual Effect.forkScoped
yield* queue.events.pipe(
  Resource.runForEachTagScoped({
    Enqueued: (e) => /* e.entries, e.priority */ …,
    Completed: (e) => /* e.entry, e.elapsed */ …,
    Failed: (e) => e.cause /* Cause<WorkerError> */ …,
  }),
);
```

Failure-bearing events carry the worker error typed (`Failed.cause: Cause<E>`, `Exit.exit:
Exit<void, E>`), so you can `catchTag` on them exactly like an RPC error channel. With
`runForEachTagScoped`, a handler's error surfaces in the **fiber's** failure channel (join it to
observe), not the caller's.

Over RPC the streams are chunked, which needs **ndjson** serialization on both sides — the http
helpers (`connectHttp` / `serveHttp`) default to it, so you don't have to think about it.

---

## 7. Remote safety: entries are validated against the tag's schema

When a remote client calls `enqueue` (or any item-typed verb), the **server decodes the payload
against the tag's schema before the handler runs** — the whole entry, not just the item
(`priority`, `attempts`, `timestamps` too). So an out-of-date / mismatched client sending a
malformed entry is rejected at the boundary. (Validated in `test/queue-contract.test.ts` and
`test/queue-http.test.ts`.) This is the load-bearing guarantee for future handoff / zero-downtime
deploys — a node only accepts work it can actually run.

---

## 8. Item schema versioning

Stamp every item schema with a version so released / handoff entries are self-describing:

```ts
import { withSchemaVersion } from ".../QueueResource";

const EmailJobV2 = withSchemaVersion(EmailJobSchema, 2);
```

It flows into the codec descriptor (`…/item@v2`) and the existing `ProcessManager` drift check.
**Rule:** bump on breaking item-shape changes; evolve *additively* within a version (so a newer
receiver still accepts same-version entries from an older sender). A typed migration/upcaster
(`VersionManager`) is designed but deferred — see `queue-port-and-observability-plan.md`.

---

## 9. Status for consumers

- **Local layer:** complete and tested — build UIs against it now.
- **Remote client:** complete — `Resource.client(tag)` + transport.
- **`logs` stream:** complete — opt-in via `captureLogs` (see §8/streams).
- **Remote serving helper, `enqueueEncoded`:** pending, all additive.
- **Import:** from `QueueContract` (module path), not the barrel, for now.

Build remote-facing UIs locally today; the layer swap is the only thing that changes when the
remote side lands.
