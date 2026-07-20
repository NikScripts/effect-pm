---
"@nikscripts/effect-pm": minor
---

**`Resource.Node.Prototype`** — Node-family templates + dynamic instances.

- Nesting: `Resource.Node.Prototype` (not top-level `Resource.Prototype`).
- `.make(name, addr)` → constructible named clone (`prototypeKey#name`).
- `.instance()` / `.instance(suffix)` → listen Node; ephemeral ipc; **no** Identity claim; many may run.
- Multi-instance `lookupClient` stays fail-closed (D4 picker still open).
