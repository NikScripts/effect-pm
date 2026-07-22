---
"hyperlink-ts": minor
---

Remove the pre-toolkit legacy layer (plan 17). The `Resource` toolkit + persistence now
supersede it, so the bespoke control plane and orchestration are deleted:

- **Control plane:** `ControlService`, `ControlProtocol`, `ControlTransportRpc`,
  `ControlTransportHttp`, `CommandAuth`, `LogTransportRpc`, `Transport` (`httpEndpoint`).
- **Orchestration:** `ProcessManager`, `ProcessGroup` (+ the `store/ProcessGroup` facet /
  `ProcessGroupStore`, removed from the composed `ProcessStorage`).
- **Terminal:** `Terminal`, `TerminalRpc` (dropped; use SSH).
- **Legacy CLI:** `cli` (`createCli`/`runCli`) and the `effect-pm` / `effect-pm-group-child`
  bins.

Replacements (all shipped): remote control → `Resource.client`/`server`/`serveHttp`/`Host`;
many instances → `Resource.serveInstances`; group organization → `Group` (nestable);
runtime-wide logs → `HostLogs`; durability/history → `DurableQueueStore` / `HistoryStore`.
Their subpath exports are removed. Kept log infra (`LogEntry`/`LogContext`/`Logs`, still named
`ProcessManagerLog*`) is unchanged; a neutral rename is a separate follow-up.
