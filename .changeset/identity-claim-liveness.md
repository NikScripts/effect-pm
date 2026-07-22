---
"@nikscripts/effect-pm": minor
---

**Identity claim liveness** — Lookup Identity mirrors directory `livenessReplace`.

- On `claim`, a different dial target pings the incumbent via `NodeStatus.ping`.
- Dead / unreachable → claim released and newcomer wins; alive → `DuplicateIdentity`.
- Same dial target refreshes without error (idempotent reclaim).
- Clearer `IdentitySelfRequired` message (Lookup + dialable self).
- Teaching form: `examples/forms/resource/node-identity-coordinator.ts` (one brain, many hands).
