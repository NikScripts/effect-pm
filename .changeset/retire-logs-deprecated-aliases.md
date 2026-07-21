---
"@nikscripts/effect-pm": minor
---

**Remove deprecated Logs flat aliases** — use the namespace surface.

Dropped from `Logs` / the root barrel: `LogRelay`, `replayLogEntry`, `captureLogger`, `captureLoggerLayer`, `relayLayer`, `logsRelayLayer`, `logRelayLayer`, `relayOnlyLayer`, `relayWithCaptureLoggerLayer`. Canonical names: `Logs.layer`, `Logs.Relay`, `Logs.replay`, `Logs.stream`, `Logs.snapshot`.
