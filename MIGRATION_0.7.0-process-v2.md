# Migrating to Process v2 (effect-first, polling + schedule)

**Shipped in `@nikscripts/effect-pm@0.7.0-beta.0`.** For the release checklist (npm, version line), see [docs/MIGRATION_0.6-beta.2-to-0.7-beta.0.md](./docs/MIGRATION_0.6-beta.2-to-0.7-beta.0.md).

This note covers the **breaking** redesign of `Process` described in
`docs/plans/09-process-v2-effect-first.md` (landed in the `0.7.x` line).

## What changed

### Before (`0.6.x` and earlier)

- `Process.make` took **`crons`** (and related options) on the config object.
- The library owned how “schedule” and “polling” were entangled.

### After (`0.7.x`)

- `Process.make` takes:
  - **`effect`** — `Effect<void, E, R>` (primary surface).
  - **`polling`** — optional `Polling` **layer** (cadence between ticks while armed), e.g. `Polling.spaced(Duration.seconds(5))`.
  - **`schedule`** — optional `ProcessSchedule` **layer** (gate: armed vs disarmed), e.g. `ProcessSchedule.alwaysArmed` or `ProcessSchedule.cronMatch({ crons: … })`.
- Either `polling` / `schedule` can be **omitted** on `make` and supplied when you **fork** `process.effect` (merge the layers into `Effect.provide`), or attached via **`Process.providePolling`** / **`Process.provideSchedule`** on a base `ProcessMakeConfig`.

## Replacing `crons: Cron.make(…)`

1. **Gate from cron** — use `schedule: ProcessSchedule.cronMatch({ crons: Cron.make(…) })`.  
   This arms the process when any expression matches “now”. Re-evaluation uses the **wall clock** (`sampleInterval`, default **1 second**); it does **not** follow `TestClock`. Pass a shorter `sampleInterval` only if you need snappier transitions.

2. **Cadence** — choose an explicit poll interval, e.g. `polling: Polling.spaced(Duration.minutes(1))`.  
   While **armed**, instances wait `awaitNextTick` between repeats. When the gate becomes **disarmed**, each running instance exits naturally on its next gate check. The package still exports `computeDisarmedIdleSleep` and `resolveDisarmedFallbackPoll` for custom schedule logic and tests.

3. **Tests** — prefer `ProcessSchedule.fromArmedRef({ armed: someRef })` so arm state is deterministic.

## `runOnStartup`

There is **no** `runOnStartup` field on `Process.make`. Call **`process.runImmediately()`** (or `ProcessGroup.runProcessImmediately` when using a group) where you want an extra tracked run.

## Types and exports

- New symbols: **`Polling`**, **`ProcessSchedule`** (context tags + static layer factories), types **`PollingService`**, **`ProcessScheduleService`**.
- `ProcessDetails` / group status fields now include **`armed`**, **`nextPollCadence`** (and related HTTP fields) alongside execution analytics.

## Checklist

- [ ] Replace `crons` with `schedule` (+ optional `polling`).
- [ ] Provide `ProcessStore.layer` (or Prisma adapter) if you rely on execution history / `getStatus`.
- [ ] Replace `runOnStartup` with an explicit `runImmediately` call if needed.
- [ ] Re-read `README.md` “Process configuration”, `docs/PROCESS-API.md`, `examples/example.ts`, and `examples/process-supervisor-patterns.ts`.
