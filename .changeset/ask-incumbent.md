---
"hyperlink-ts": minor
---

**askIncumbent** directory advertise policy with inheritance:

- `OnConflict` / `resolveOnConflict` on `Node` (`livenessReplace` | `askIncumbent` | `reject` | `inherit`)
- Stamp on `Node.Tag` / `Node.Lookup` / `Prototype` (Lookup defaults concrete `livenessReplace`; ordinary nodes default `inherit`)
- Call-site `onConflict` on `unix` / `http` / `ws` / `nPipe` listen options
- Lookup finishes resolve from its node stamp; `askIncumbent` dials reserved `NodeStatus.yield` (accept → replace; refuse/timeout → `IncumbentAlive`)
- Dial-matched `unregister` so a late incumbent finalizer cannot wipe the newcomer after handoff
