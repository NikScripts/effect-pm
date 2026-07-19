---
"@nikscripts/effect-pm": minor
---

**Dynamic `Prototype.instance`** — many ephemeral workers from one prototype.

- `Proto.instance()` / `Proto.instance(suffix)` → Node for `Resource.listen` (not a class ctor).
- Wire key `prototypeKey#suffix` (suffix minted at listen when omitted); always ephemeral ipc path.
- **No** `Identity.claim` — many instances may run; directory advertise + `livenessReplace` on dupe keys.
- Multi-instance `lookupClient` stays fail-closed (D4 picker still open); use peers / explicit Node.
