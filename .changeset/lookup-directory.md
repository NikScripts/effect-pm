---
"hyperlink-ts": minor
---

**Lookup node directory (D5/D6)** — advertise / list / unregister on the same Lookup server as identity claims.

- New `Lookup.Directory` RPCs: `advertise`, `unregister`, `nodesServing`.
- Duplicate `nodeKey` uses **livenessReplace** (NodeStatus `ping`; alive → `IncumbentAlive`; dead/timeout → replace).
- `Resource.listen` soft-advertises derived `serves[]` when `Directory` is provided; unregisters on clean scope close.
