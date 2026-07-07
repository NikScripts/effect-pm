# Store cutover — Queue (my target)

Prereq: `store-cutover-00-store-core.md`. This module owns the **shared store-tap helper** the other three
depend on, plus the queue engine cutover.

## Done

- `builtInQueueStoreContract(tag)` — one `event` shape persisting the shared `QueueEvent<T>` union
  (`record`/`events`), **cast-free** (the reference other modules mirror to drop their casts).
- Store tightening + `layerDefaultMemory` (shipped; see store-core report).

## In progress / blocked

- **Engine wiring deadlocks.** WIP commit `0e48e9d28` on branch `queue-store-wiring`: `buildQueueImpl`
  resolves the store handle **during layer build** and passes `recordEvent` to the engine; `publishEvent`
  persists. It compiles and breaks no existing test (117 green), **but** resolving the store in the layer
  build deadlocks a later `Store.Service.at(tag)` read (scoped-layer memoization lock). Verified by
  isolation: `yield* AppStore.at(tag)` never returns.

## Plan (owner: me)

1. [ ] **Build `internal/store/storeTap.ts`** — the shared helper: create the event buffer immediately,
       fork **one** scoped daemon that resolves the handle **once** (eager, not lazy, not build-time) and
       drains the buffer to `handle.record`. Returns a sink (no-op when no store in context). No
       `serviceOption` on the emit path.
2. [ ] **Prove it dodges the deadlock** — the same queue + `AppStore.at` case that currently hangs must
       pass (persist events → read back via the app store).
3. [ ] **Cut the engine over to it** — `publishEvent` → the tap's sink; delete the current build-time
       resolution in `buildQueueImpl` and the reverted per-event facet tier.
4. [ ] Hand `storeTap.ts` to Process + RunResource (they adopt it — see their reports).

## Non-goals / rejected

- Lazy per-event or per-run resolution (owner rejected; it's what RunResource must migrate *off*).
- Build-time resolution (deadlocks).
- Layer-level schema overrides (unsafe for RPC — result-schema doc §3).

## Verify
`pnpm typecheck` (both) + queue suites + a new `queue-store-persist` test (persist → read back via app store).
