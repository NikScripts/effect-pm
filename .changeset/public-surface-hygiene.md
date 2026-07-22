---
"hyperlink-ts": patch
---

Public-surface hygiene for loud failures and namespace parity.

- Root barrel flat-exports `MissingClientProtocol` / `ProtocolMismatch` (alongside other Resource errors) and `export * as MultiNode`.
- Queue codec/error helpers on the root barrel re-export from `QueueResource` (not `internal/queueResource`).
- Type-level locks for the loud-failure error shapes (`.test-d.ts`).
- Remove leftover `internal/manager/logCapture` / `logPersistRelay` migration shims (callers use `internal/logs/relay`).
