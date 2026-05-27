# 08 — Lifecycle kernel & process lifecycle hooks

## Lifecycle machine (exploratory)

Internal typed transitions for queues, queue items, processes, schedule rows:

- Explicit **allowed actions** vs **illegal transitions**.
- Projection-friendly events; tighter control/eligibility semantics for HTTP/CLI —
  **not** an external statechart engine.

Starts from **`effect-pm` domains**, not wholesale XState cloning.

## Process lifecycle hooks (**`Process`**)

Optional extension points (**`onStarted`**, **`onTickFailed`**, schedule arm hooks,
…) that receive **process-bound controls** — schedule still arms, polling still
ticks, **`effect`** remains the workload unit.

**Non-goal**: a second shadow supervisor hiding user logic.
