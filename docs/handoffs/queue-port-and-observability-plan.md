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

- **`onFailure?`** *(LOCKED)* — `(entry, cause) => Effect<"retry" | "deadLetter" | "drop" | "default", never, R>`.
  Per-error disposition, overriding the default retry policy.
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
- **P1b** — engine triad wiring: bounded `PubSub` for `events` (publish at the ~14 sites),
  `SubscriptionRef` for `status` (+ in-flight), windowed `metrics` emitter; register Effect
  `Metric`s for OTEL; remove the 14 callbacks; keep `onFailure` + `onError`.
- **P-logs** — generic `logs` on the toolkit: alias `logEntry`, conditional `{ logs: true }`
  member + auto-wired capture/relay, console helper, real-http test.
- **P3** — data-plane verbs on the contract: `prioritize`/`defer`/`release`/`releaseEncoded`/
  `deadLetter`/`drop` + `QueueEntry` readers.
- **P4** — adapter (engine handle → toolkit service) + export from barrel; convert hook-based
  tests/examples to subscribe to `.events`; real-http triad/quad test; update the new-features
  guide.

Verify every phase: `pnpm typecheck` (both tsconfigs), Effect LSP CLI on touched files,
`pnpm lint`, `pnpm test`, `pnpm build`. Commit per phase (owner reviews remotely).
