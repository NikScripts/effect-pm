---
"hyperlink-ts": minor
---

**BREAKING — node status/logs/ping now live on the connected node handle; the `NodeStatus` module is gone.**

Every node auto-serves its own status, logs, and reachability, and you now read them straight off a
connected node handle instead of through a separate reserved resource:

```ts
const n = yield* MyNode          // n : NodeProtocol
yield* n.ping                    // round-trip ms
yield* n.status.get              // NodeStatus snapshot
n.status.changes                 // Stream of snapshots
n.logs.stream                    // Stream of log entries
yield* n.logs.query({ limit })   // recent entries
```

Because a node tag *is* its own `Context.Service`, each handle dials that node's transport — reading
node A vs node B is just `yield* NodeA` vs `yield* NodeB`, with no shared slot to re-point and no cast.

Migration:

- The `hyperlink-ts/NodeStatus` module and the `Node.status` namespace are **removed**. Replace
  `client(NodeStatus.Tag, node)` / `NodeStatus.*` reads with the handle accessors above
  (`(yield* node).status` / `.logs` / `.ping`).
- The few light types survive as flat `Node` exports: `Node.Status` (the snapshot type, formerly
  `NodeStatus`), `Node.ResourceReadiness`, and the `Node.resourceReadiness` wire schema (for composing
  your own health surfaces — e.g. `FleetHealth`).
- The status engine is a lazy internal — a `Node.Tag`-only import stays light (no status/server code
  pulled), so browser/dashboard bundles that only reference the tag are unaffected.
