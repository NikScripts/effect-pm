---
"@nikscripts/effect-pm": minor
---

**Logs platform** — one module, one bus, one capture.

- **`Logs`** is the single public logs module (`layer`, `stream`, `snapshot`, `replay`, `withScope`, `persistLayer`, `byNode`, `byResource`).
- **`NodeLogKey`** / **`ResourceLogKey`** / **`nodeLogKey`** — typed key vocabulary; full catalog in `docs/LOGS.md`.
- **`NodeLogs`** is a deprecated shim re-exporting `Logs`.
- **`LogStore`** migrates off `ProcessStore` to `Store.contract` + `Store.Service` (event journal bridge).
- **`LogEntry`** adds `lineage`, `hasKey`, `atRoot`, `atLeaf` predicates; lineage annotation key on `LogContext`.
- **`Resource.logs`** / **`Resource.withLogExport`** for per-resource export (`{ stream, query }`).
- Duplicate relay (`logPersistRelay`) collapsed into `internal/logs/relay.ts`; `persistLayer` subscribes to relay (no second capture logger).

Legacy per-resource `captureLogs` / spec `logs` groups remain for one release — use `Logs.layer` + `Resource.logs` for new code.
