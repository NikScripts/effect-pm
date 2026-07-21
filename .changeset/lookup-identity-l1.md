---
"@nikscripts/effect-pm": minor
---

**Lookup identity server (L1)** — first-wins claims over IPC.

- New `@nikscripts/effect-pm/Lookup` module: `LookupNode`, `Identity.claim`, `DuplicateIdentity`.
- Same-machine default: `layerIpc` / well-known ipc path — OS bind exclusivity (no cross-network elect).
- Explicit `LookupNode({ path })` + `layer` / `client` for addressed lookup.

Follow-ons (not this slice): resolve/getClaim RPC, Singleton layer-swap, nodeless clients, manager LB streams.
