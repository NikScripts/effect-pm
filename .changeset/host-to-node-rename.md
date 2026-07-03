---
"@nikscripts/effect-pm": minor
---

**Rename `Host` → `Node` (breaking), plus export cleanups.** "Host" implied a machine, but a fleet member
is a per-process runtime (many per box); `Node` is accurate and avoids confusion with Effect's
`HttpApiEndpoint`.

**Migration (find/replace):**
- `Resource.Host` → `Resource.Node`; `HostKey`→`NodeKey`, `AnyHost`→`AnyNode`, `HostBoundTag`→`NodeBoundTag`,
  `SelfHostId`→`SelfNodeId`, `HostRef`→`NodeRef`.
- `hostOf`→`nodeOf`, `selfHost`→`selfNode`, and the tag construct option `{ host }` → `{ node }`.
- `Resource.multiHost([...])` → `Resource.distributed([...])`; `peersLayer(tag, self, { hosts })` →
  `{ nodes }`.
- Subpaths: **`@nikscripts/effect-pm/HostStatus` → `/NodeStatus`**, **`/HostLogs` → `/NodeLogs`**; barrel
  namespaces `HostStatus`/`HostLogs` → `NodeStatus`/`NodeLogs`.
- ApiMetrics: `ApiMetricsHostTag` → `ApiMetricsNodeTag`; its `{ host }` option → `{ node }`.

**Wire-visible (both ends must be on this version):**
- `kind` strings for the reserved status/logs resources changed (`.../HostStatus` → `.../NodeStatus`).
- The structured-log annotation key changed from `host` to `node` — log queries filtering on `host` must
  update.

Also in this release: `./ScheduledProcess` now resolves to its tree-shakeable namespace (schemas
re-exported), and `ApiMetrics` is flat `export * as ApiMetrics` (the `ApiMetricsModule` name is gone).
