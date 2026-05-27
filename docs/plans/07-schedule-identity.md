# 07 — Schedule identity and persistence boundaries

Apps own authoritative schedule/domain state; **`ProcessSchedule`** stays the runtime
mirror.

Goals:

- **Stable string IDs** for every entry participating in **`get`/`upsert`/`remove`/`reconcile`**.
- **Cleanup semantics** — pending sleep fibers interrupted when entries disappear;
  running instances converge without guessing by timestamp-only keys.
- Optional future **`ProcessScheduleStore`** adapter — **do not** fold schedule
  persistence silently into **`ProcessStore`** aggregates.
