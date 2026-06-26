---
"@nikscripts/effect-pm": minor
---

`QueueResource`: add a first-class **`refill`** config — a self-feeding queue that loads work from a
source (DB, …) on start and/or whenever it drains empty. The toolkit replacement for the legacy
`onStart` / `onDrained` lifecycle hooks:

```ts
QueueResource.layer(RosterQueue, {
  effect,
  refill: {
    onStart: true,                 // bootstrap once when the worker pool starts
    onDrained: true,               // re-poll the source each time the queue drains
    load: (queue) => loadFromDb(queue),
  },
});
```

`load` receives the queue handle, runs in the worker `R`, and is best-effort. `onStart` is forked
(a slow source load doesn't block startup); `onDrained` runs after each `Drained` (drives the
self-feeding loop, and idles when `load` enqueues nothing). Distinct from after-the-fact `events`
observation — `refill` is a defining queue behavior (a pull source).
