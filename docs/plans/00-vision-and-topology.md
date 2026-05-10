# 00 — Vision & topology

## What `effect-pm` is

`effect-pm` is a process orchestration runtime built on
[Effect](https://effect.website/). It runs scheduled cron-style processes,
priority-based queue resources, and an event-first analytics store, all under
a single coherent service model.

## Topology (today and tomorrow)

```
┌──────────────────────────────────────────────────────────────────────┐
│                         (future) ProcessManager                       │
│   coordinates many ProcessGroup instances across hosts                │
│   over Effect RPC / HTTP — NOT IMPLEMENTED YET (see 08-)              │
└──────────────────────────────────────────────────────────────────────┘
                                 │
                                 │ RPC / HTTP control + events
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         ProcessGroup (one per host)                   │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                │
│   │  Process A   │  │  Process B   │  │  Process C   │                │
│   └──────────────┘  └──────────────┘  └──────────────┘                │
│   ┌──────────────┐  ┌──────────────┐                                  │
│   │ QueueResource│  │ QueueResource│                                  │
│   └──────────────┘  └──────────────┘                                  │
│           │                │                │                          │
│           ▼                ▼                ▼                          │
│   ┌──────────────────────────────────────────────────────────────┐    │
│   │                    ProcessStore (analytics)                  │    │
│   │   memory()  |  PrismaProcessStore (subpath)                  │    │
│   └──────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
```

## Three-tier mental model

1. **Process / QueueResource** — the units of work. A `Process` is a
   scheduled effect; a `QueueResource` is a managed effect executor with
   priority, concurrency, throttling, and storage hooks.
2. **`ProcessGroup`** — the cohesive bundle. Owns lifecycle, control HTTP
   API, and analytics wiring for the processes/queues that ship together.
   This is the unit of deployment today.
3. **(future) `ProcessManager`** — the multi-group coordinator. Treats each
   `ProcessGroup` as a peer and exposes a single management surface across
   hosts. Implementation is deferred (see `08-process-manager-future.md`).

## Why this split

- **Separation of concerns**: a `ProcessGroup` is purely a runtime
  embedding; it has no opinion about how many of itself exist. A future
  `ProcessManager` can be implemented and deployed independently.
- **Independent scaling / hosting**: groups can be deployed per-tenant,
  per-region, or per-feature without changing the API surface inside any
  one group.
- **Analytics consistency**: `ProcessStore` is the same shape no matter
  where the events come from — local in-memory, file-backed, Prisma, or
  proxied from a remote `ProcessGroup`.

## Non-goals (current scope)

- A multi-group `ProcessManager` runtime. Designed but deferred.
- A bespoke deploy/handoff orchestration layer. Out of scope; if needed,
  it lives inside the future `ProcessManager`.
- Backwards compatibility with anything before this rename. We are
  pre-1.0 (`0.6.0-beta.x`), so naming is locked once, here.
