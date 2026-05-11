# effect-pm Architecture Plans

Living, canonical specs for the runtime + analytics architecture of
`@nikscripts/effect-pm`. Anything in here is the source of truth: code that
disagrees with these documents is the bug, not these documents.

**Also read (outside this folder):**

- [Package guide](../PACKAGE-GUIDE.md) — narrative architecture for humans and tools.
- [Agent guide](../AGENTS.md) — repository map and invariants for assistants.
- [Process / polling / schedule API tables](../PROCESS-API.md) — concise reference.
- [Examples README](../../examples/README.md) — runnable teaching scripts.

The set is intentionally small. Each file owns exactly one concept; the
numbering encodes reading order, not priority.

| #  | Doc                                                       | Status      |
| -- | --------------------------------------------------------- | ----------- |
| 00 | [Vision & topology](./00-vision-and-topology.md)          | Living      |
| 01 | [Naming & consistency contract](./01-naming-contract.md)  | Living      |
| 02 | [Implementation status](./02-status.md)                   | Living      |
| 03 | [`ProcessGroup` (renamed orchestrator)](./03-process-group.md) | Living      |
| 04 | [`Process` types & schedule control](./04-process-types-and-control.md) | Living      |
| 05 | [State & reconciler](./05-state-and-reconciler.md)        | Living      |
| 06 | [`ProcessStore` analytics service](./06-process-store.md) | Living      |
| 07 | [`QueueResource` storage hooks](./07-queue-resource.md)   | Living      |
| 08 | [Top-level `ProcessManager` (multi-group)](./08-process-manager-future.md) | Deferred    |
| 09 | [Process v2 — effect-first, Layer polling & schedule](./09-process-v2-effect-first.md) | **Canonical** (implementation target) |
| 10 | [Schedule controls, reconcile, and removal cleanup](./10-schedule-controls-and-reconcile.md) | Planned (next beta) |
| 11 | [Strict `@effect/language-service` rules](./11-strict-effect-language-service.md) | Planned (tooling / typing backlog) |

If you are about to add a new concept that is not described here, write
the doc first.

**Process runtime:** implement against [09](./09-process-v2-effect-first.md).
[04](./04-process-types-and-control.md) is historical for multi-schedule /
reconciler ideas unless rewritten to match 09.
