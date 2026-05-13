# 04 - Schedule identity and persistence boundaries

## Status

Planned.

## Intent

Clarify what schedule state is, where it lives, and how runtime schedule entries
are safely synced and removed.

## Persistence boundary

`ProcessStore` should not be the default mutable schedule database.

Schedules are usually domain state: game windows, customer jobs, campaign
windows, billing cycles, polling targets, and other business concepts. The
application should own that truth in its own database or service.

`ProcessSchedule` should remain the runtime schedule service. Apps sync their
domain schedule truth into it.

Possible future extension:

- `ProcessScheduleStore` for applications that want a library-provided schedule
  persistence adapter.

Do not hide schedule persistence inside `ProcessStore`.

## Stable identity

Runtime schedule mutation requires stable identity.

Entries involved in `get`, `has`, `upsert`, `remove`, `removeMany`, or
`reconcile` should have stable string IDs. Without IDs, runtime cleanup has to
guess by timestamps and indexes.

Design options:

1. Make `id: string` required for every `ProcessScheduleEntry`.
2. Keep no-ID helpers for static one-off schedules, but require IDs for all
   mutation and sync APIs.

Preferred path:

- introduce an identified entry type first,
- require identified entries for sync/removal APIs,
- later decide whether beta can make `id: string` universal.

## Runtime removal cleanup

When an identified entry is removed:

- pending sleeper fibers for that entry should be interrupted,
- running instances should observe that their entry no longer exists and exit
  naturally before the next poll,
- completed entries should be cleaned from runtime bookkeeping,
- no new instance should be spawned for a removed entry.

## Runtime keying

Schedule instance keys should be based on stable IDs where available.

Timestamp/index keys are acceptable only for non-mutable static schedules. They
should not be used for DB sync semantics.

## Reconcile language

Keep `ProcessSchedule.reconcile(next)` as a schedule sync operation.

Do not revive the old runtime-wide target/live reconciler architecture. Schedule
sync is useful; a broad reconciler is not the current runtime model.

## Candidate API changes

- `ProcessSchedule.entry(id)`
- `ProcessSchedule.at(id, startAt)`
- `ProcessSchedule.window(id, startAt, stopAt)`
- `ProcessSchedule.reconcile(identifiedEntries)`
- `Process.scheduleControls` exposes full schedule controls:
  - `entries`
  - `get`
  - `has`
  - `set`
  - `add`
  - `upsert`
  - `remove`
  - `removeMany`
  - `clear`
  - `reconcile`

## Graduation criteria

- Schedule sync/removal APIs require stable identity.
- Runtime pending and running cleanup honors removed IDs.
- `Process.scheduleControls` has parity with `ProcessScheduleService`.
- Examples show app-owned DB schedule sync.
- Docs clearly state that `ProcessStore` records history, not schedule truth.
