# effect-pm Architecture Plans

Living, canonical specs for the runtime + analytics architecture of
`@nikscripts/effect-pm`. Anything in here is the source of truth: code that
disagrees with these documents is the bug, not these documents.

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

If you are about to add a new concept that is not described here, write
the doc first.
