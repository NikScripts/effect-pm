# Polling modernization — decisions

Owner-approved 2026-07-20. Kills the last top-level API surface and brings Polling up to the
namespace standard. Work from THIS doc; do not regenerate shapes from memory.

## Locked decisions

1. **Own module namespace, not Resource/Process.** `export * as Polling from "./Polling"` in the
   barrel. Polling is cadence policy FOR processes, but it is neither a resource nor a process —
   it gets no `Tag` factory and never will.
2. **The Context tag is INTERNAL.** `PollingTag` moves to `src/internal/pollingTag.ts`. The
   namespace exposes no tag member — `Tag` would falsely suggest the Resource-style contract
   factory. Public verbs replace it:
   - `Polling.layer(impl)` — custom cadence; wraps the internal tag + process-layer brand
     (replaces `Layer.succeed(Polling, impl)`).
   - `Polling.current` — yieldable inside a process effect (`Effect<Service, never, PollingTag>`)
     for wake/reset/peek (replaces `yield* Polling`). The internal tag TYPE appears in the R
     position only; consumers never provide it themselves (the supervisor does).
3. **Renames (clean break, zero external users):**
   - `PollingService` → `Polling.Service` (exported interface)
   - `AcceleratingPollConfig` → `Polling.AcceleratingConfig`
   - presets keep their names — `Polling.spaced/jittered/backoff/accelerating/acceleratingWithRefs`
     call sites do not change at all (`import { Polling }` namespace member access is identical).
4. **Dead surface removed:** `Service.overlap` ("serial" | "concurrent") — nothing in the engine
   reads it; only serial ever existed. Reintroduce if/when concurrent is real.
5. **disarmedIdleSleep → `src/internal/disarmedIdleSleep.ts`.** FINDING: the module is ORPHANED —
   no engine code consumes it (only its own test + doc comments). Moving it internal preserves the
   policy + test; whether the supervisor should actually USE it (or it should be deleted) is a
   flagged follow-up for the process owner — not decided here.
6. **Barrel:** `export { Polling }` / `export type { PollingService, AcceleratingPollConfig }`
   replaced by `export * as Polling`. Top-level module in the API reference disappears entirely.

## Approved follow-up features (separate slices, in order)

- **`Polling.dynamic(field)`** — cadence from a DynamicConfig field (the remote-config-swap demo:
  hot-swap a poll interval across machines, no restart).
- **Cadence on the process handle** — `wake`/`resetCadence` as process controls; `cadence`/
  `nextTickAt` as a Subscribable on process status (dashboard countdown + Wake button;
  `peekCadence` becomes the stream's source rather than a UI-polled effect).

## Deferred (not approved yet)

`Polling.adaptive` (work-aware decay), `Polling.cron`, event-driven wake (store event →
`requestWake`). Disarmed-policy public surface (`Polling.disarmed(...)`) waits on follow-up #5.

## Verification bar

Root tsc + full tests + LSP clean on touched files; the 2 `yield* Polling` examples and
`Layer.succeed(Polling, …)` tests migrated; docs regen shows NO top-level module for effect-pm;
check-links 0 dead; docs suite green.
