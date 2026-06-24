# QueueResource.Tag port + observability quad — locked plan

The decisions doc for finishing `QueueResource.Tag` on the Resource toolkit and the
observability model. **Work from this; do not reconstruct shapes from memory.** Status of
each phase is marked; check boxes as they land.

## Context / correction

- `Resource.Tag` = author **custom** resources. `QueueResource.Tag` / `Process` / `RunResource`
  etc. are **not** going away — they're being rewritten **onto** the toolkit so they're
  location-transparent (local impl ⇄ RPC client, same `yield* Tag`).
- The QueueResource **engine** (`src/QueueResource.ts`, ~3000 lines: workers, retry, dedup,
  rate-limit) is the **behavior source of truth** and stays. The port re-expresses its surface
  on the toolkit (`src/QueueContract.ts`) + a local layer adapter that wraps the engine handle.
- `QueueResource.Tag` is **partially** ported (control surface + `add` + the designed
  `class X extends QueueResource.Tag<X>()(id, itemSchema)` form). The rest (below) finishes it.

## Observability = a quad of streams on the SERVICE (not config)

Observation moves **off the config** and **onto the service/contract**. Four streams:

| Stream | What | Schema | Contract location |
|---|---|---|---|
| `.status` | current-state snapshot (instantaneous truth) | `queueStatus` | `queueControlSpec` (no item type) |
| `.events` | discrete entry/worker/queue lifecycle facts | `queueEvent(itemSchema)` (tagged union) | `queueSpec` (item-typed) |
| `.metrics` | **windowed** aggregates (per-window counts + throughput/latency) | `queueMetrics` | `queueControlSpec` |
| `.logs` | the resource's log lines — **optional**, opt-in via the tag | `logEntry` | conditional member (see Logs) |

`.status`/`.events`/`.metrics` are **always present**; `.logs` appears only when the tag opts
in (`{ logs: true }`) and disappears from the type otherwise (same conditional-member machinery
as host-on-tag). **[Phase 1a DONE]** for status/events/metrics contract shapes.

### Two-tier delivery (why streams are safe)

- **Guaranteed tier** = `QueueResourceStore` (every event, ordered, durable) — already wired
  inline in the engine. For correctness-critical reactions (billing, sagas).
- **Fan-out tier** = the quad streams (concurrent, many subscribers, lossy-OK via a bounded
  sliding `PubSub`). For observation (dashboard/CLI/TUI).

The old 14 fire-and-forget callbacks were observation in the wrong place → replaced by the
quad. A stream cannot be lossless + ordered + non-coupling simultaneously, so guaranteed needs
stay on the store tier.

## Config = control only (the legitimate inline hooks)

Config keeps **only** decisions the engine must run inline (in the worker `R`) and act on — a
stream can't, being after-the-fact. Config is local-only anyway (the `effect` worker can't
cross RPC).

- **`onFailure?`** *(LOCKED — SHIPPED)* — `(entry, cause) => Effect<"retry" | "deadLetter" | "drop" | "default", never, R>`.
  Per-error disposition, overriding the default retry policy. `"retry"` re-enqueues honoring the
  `attempts` budget; `"deadLetter"`/`"drop"` emit the matching event without re-enqueue;
  `"default"` falls back to the queue policy. Runs inline in the worker `R`.
- **`onAdmit?`** *(OPTIONAL / deferred)* — `(batch) => Effect<"accept" | "reject", never, R>`.
  Enqueue admission control. Add only if a concrete need appears.

Everything else (`onStarted`/`onCompleted`/`onExit`/`onDrained`/`onCleared`/`onReleased`/
`onDeadLettered`/`onDropped`/`onRetryScheduled`/`onRetryExhausted`/`onRateLimitExceeded`/
`onStart`/`onEnqueued`) is **removed** — observation → `.events`; durable → store. Keep the
engine's internal `onError` sink (not a lifecycle event).

## Logs — generic, opt-in, over the unified RPC

- **Not** the old `LogTransportRpc` / `LogRpc` / `ProcessManagerLogRelay` (bespoke, legacy).
  `.logs` is a normal `Resource.stream(logEntry)` member on the resource's **own** RPC group —
  one transport for verbs + status + events + metrics + logs. The old log RPC is superseded;
  ProcessManager can migrate onto the toolkit later and it gets deleted.
- **Reuse, don't move (SSOT):** the existing log-entry shape is generic and imported in ~18
  places — alias it as the toolkit `logEntry` (one definition, no fork); reuse `captureLogger`
  (3 importers — can be lifted to a neutral `src/log/` later, cosmetic). Defer the PM-prefix
  rename.
- **Wiring (auto on opt-in):** `{ logs: true }` on the tag → the contract gains `logs`, and the
  local layer auto-wires a capture `Logger` feeding a **per-resource** bounded `PubSub` + small
  replay tail (tagged with the resource id). The impl provides nothing.
- **Stream shape:** prelude/replay (last N lines on connect) **+ follow** — what a CLI/TUI
  wants. `logs: Stream<logEntry>`.
- **Helper:** a console sink helper (drain `logs` → pretty-print to stdout) for CLI; the raw
  stream stays open for a web UI / file / OTEL / anything.
- **Generic:** lives on the `Resource` toolkit → every resource gets it; `Process` & the rest
  inherit it once ported.

## Phases (order)

- **[DONE] P1a** — triad contract shapes (`queueStatus`/`queueEvent`/`queueMetrics` + spec).
- **[DONE] P1b** — engine triad wired on the **handle** (`QueueHandleApi`): bounded sliding
  `PubSub` for `events` (published at every lifecycle site), `SubscriptionRef` for `status`
  (recomputed from authoritative sources, incl. in-flight), dynamic-window `metrics` emitter
  (counts accumulated inline at the source; flush early on significant events). The 14
  callbacks are **removed**; observation is via the streams. Typed errors carried on
  `QueueEvent<T, E>` (`cause: Cause<E>` / `exit: Exit<void, E>`); `attempts` auto re-enqueue;
  `enqueue` re-injects `QueueEntry`s off `.events`. `Resource.runForEachTag` helper added for
  tag-dispatched consumption. The `onFailure` config hook is wired (LOCKED shape: returns
  `"retry" | "deadLetter" | "drop" | "default"`, runs inline in the worker `R`; its services
  are folded into `InferQueueWorkerRequirements`). Effect `Metric`s registered for OTEL
  (per-queue tagged counters `queue_*_total`, an `queue_in_flight` gauge, and a
  `queue_processing_duration_ms` histogram, updated inline alongside the window accumulator).
  Tests/examples converted. **P1b is complete.**
- **P-logs** — generic `logs` on the toolkit: alias `logEntry`, conditional `{ logs: true }`
  member + auto-wired capture/relay, console helper, real-http test.
- **[DONE] P3** — data-plane verbs on the contract. Enqueue verbs (`prioritize`/`defer`/
  `enqueue`) and entry-returning verbs (`release`/`releaseEncoded`/`deadLetter`/`drop`) are all
  wired on `queueSpec`, with wire schemas `queueEntrySelector`/`queueReleaseOptions`/
  `queueRouteOptions`/`queueEncodedEntry`/`queueReleaseEncodingError`. The engine's
  `QueueItemEncodingError`/`QueueMissingItemSchemaError` were converted from `Data.TaggedError`
  to **`Schema.TaggedErrorClass`** (SSOT — one class, both yieldable and wire-encodable), so
  `releaseEncoded`'s error channel crosses RPC and `catchTag` works client-side (tested).
  **Remaining:** `enqueueEncoded` — the engine has no such handle method; it's a decode +
  `enqueue` composition, so it belongs to the **P4 adapter** (decode `queueEncodedEntry` via the
  instance `itemSchema`, then call `enqueue`). The wire-faithful note: `deadLetter`/`drop` take
  a `queueEntrySelector` (over the wire, `entryId` identifies the target).
- **[DONE] P4** — `QueueResource.layer(tag, config)` runs the engine behind the toolkit contract.
  What actually shipped differs from the plan below in three ways, all for the better:
  (a) the enqueue verbs take their value **directly** — `add`/`prioritize`/`defer` take the item
  (the whole item schema IS the rpc payload, a single-schema payload), and `enqueue` takes the full
  `QueueEntry[]` directly; the contract/layer are parameterized by `F extends Schema.Struct.Fields`;
  (b) the `itemSchema` is recovered from `tag[specSym].add.payload` (the payload now IS the item
  schema; no extra symbol needed);
  (c) the generic `ImplOf`/`ServiceOf` deferral was fixed at the **toolkit** level (drop the dead
  always-true `extends AnyMethod` gate, branch on the `LocalMethod` brand + `[payload] extends
  [undefined]`). Combined with the single-schema payload, **all 16 verbs are honestly typed and the
  port is fully cast-free** — the decoded wire entry and the engine `QueueEntry<T>` both derive from
  the same `Schema.Struct<F>["Type"]`, so `handle.enqueue(entries)` unifies at the layer with no
  bridge cast (the wire≅engine invariant is now enforced structurally at the layer itself — the
  earlier `test/queue-contract.test-d.ts` drift guard became redundant and was removed). Remote
  enqueue validation is locked by `test/queue-contract.test.ts` (decode gate) + `queue-http.test.ts`
  (real-wire). **Remaining:** `enqueueEncoded`, the `logs` stream, real-http quad test, final guide.
  Historical design (for reference):
  1. **Thread `itemSchema` onto the tag.** In `QueueContract.queueTag.build`, stash the raw
     `itemSchema` under a new symbol (e.g. `queueItemSchemaSym`) on the returned tag, so the
     layer can recover it (don't dig it back out of `spec.add.payload.item` — stash it).
  2. **Adapter** `adaptQueueHandle(handle): ImplOf<QueueInstanceSpec<Sch>>` — a flat mapping:
     `size/sizes/isEmpty/completed/start/pause/resume/shutdown/clear/status/metrics/events`
     pass straight through; `add/prioritize/defer` = `({ item }) => handle.x(item)`;
     `enqueue` = `({ entries }) => handle.enqueue(entries)`; `release`/`releaseEncoded` =
     `({ options }) => handle.x(options)`; `deadLetter`/`drop` =
     `({ selector, options }) => handle.x(selector, options)`. **Watch the no-cast type match**
     between the engine return types and the schema-**decoded** contract types — especially
     `events` (engine `QueueEvent<T,E>` vs decoded `queueEvent` union: `Cause<E>` is assignable
     to `Cause<unknown>`; verify every variant's fields line up — `elapsed: Duration`,
     `Enqueued.priority`, `RateLimitExceeded`) and the `QueueEntry`/`QueueEncodedEntry` shapes
     (`attributes: Record<string, unknown>` vs decoded `Record<string, Unknown>`). If a variant
     doesn't line up, fix the *schema* in `QueueContract` to match the engine (SSOT is the
     engine), not via a cast.
  3. **Layer** `QueueResource.layer(tag, config)` = `Layer.unwrap(makeEngine({ ...config,
     itemSchema: tag[queueItemSchemaSym] }).pipe(Effect.map((h) => Resource.layer(tag,
     adaptQueueHandle(h)))))`. `makeEngine` = the engine `QueueResource.make`. Result:
     `Layer<Self, never, WorkerR>` (Scope excluded by `unwrap`). Add a `.Service` combined
     factory mirroring the engine's, if convenient.
  4. **`enqueueEncoded`** (deferred from P3): add `enqueueEncoded` to `queueSpec`
     (`payload { entries: Array(queueEncodedEntry) }`, success Void, error a decode error) and
     implement in the adapter as: decode each `payload` via the tag's `itemSchema`, rebuild
     `QueueEntry<T>`, then `handle.enqueue`. (The engine has no `enqueueEncoded` handle method —
     it's a compose.)
  5. **Barrel**: export the ported `QueueResource` (toolkit) + the new public schemas/types from
     `src/index.ts` (currently `QueueContract` is module-path-only).
  6. **Tests**: a local smoke test (`yield* Tag`, add, observe via `events`/`status`/`metrics`,
     release round-trip) + a **real-http** quad test (over `NodeHttpServer.layerTest` + ndjson,
     like `resource-stream-http.test.ts`) proving the streams cross the wire.
  7. Final new-features guide pass documenting the runnable toolkit queue.

## Schema versioning + migrations

**[DONE] The version stamp.** Item schemas carry a `schemaVersion` annotation (`withSchemaVersion(schema, n)` / `schemaVersionOf(schema)`, default `1`). `makeQueueItemCodecDescriptor` reads it and stamps the descriptor `id` (`…/item@vN`) and `version` — so every released / handoff entry is **self-describing** from today, feeding the existing `ProcessManager` codec id/version drift check. **The rule:** bump `schemaVersion` on any *breaking* item-shape change; evolve *additively* within a version (so a newer receiver still accepts same-version entries from an older sender — required for zero-downtime / A-B handoff, since the receiver validates against *its* schema).

The reason to do this now and nothing else: the stamp is the only time-sensitive part — entries written un-versioned are ambiguous forever.

**[DEFERRED] `VersionManager` + migrations.** A future typed upcaster, built from an **array** (tuple), genesis at the head:

```ts
VersionManager.make([
  { version: 1, schema: EmailV1 },                      // genesis — no `up`
  { version: 2, schema: EmailV2, up: (v1) => …  },      // up typed (EmailV1.Type) => EmailV2.Type
  { version: 3, schema: EmailV3, up: (v2) => …  },
])
```

- Typed via variadic-tuple inference: element 0 = genesis (no `up`); element `i ≥ 1` has `up: (prev: Type<T[i-1].schema>) => Type<T[i].schema>`. Enforce `version` strictly increasing + head has no `up`.
- Upcast flow: it **holds every version's schema**, so it decodes an old payload with the *old* schema, runs the typed `up` chain to current, and the receiver re-validates at current — typed end to end (no raw-JSON guessing).
- Pattern is the event-sourcing **"upcaster"** chain; no Effect/library primitive exists (verified) — `Schema.transform`/annotations are the only building blocks.
- Open questions to settle before building: decoded vs encoded migrations (lean decoded); plain typed value vs a `Resource`; how it binds to the queue tag's single `itemSchema` (current = head); up-only vs also down-casts for bidirectional A-B; re-validate each step or only at current.
- Phase 1 = history + typed `migrate(payload, fromVersion)`. Phase 2 = a handoff manager that *consumes* a `VersionManager` (read `descriptor.version` → `migrate` → `enqueueEncoded`), plus an optional pre-enqueue `transform` hook.

Verify every phase: `pnpm typecheck` (both tsconfigs), Effect LSP CLI on touched files,
`pnpm lint`, `pnpm test`, `pnpm build`. Commit per phase (owner reviews remotely).
