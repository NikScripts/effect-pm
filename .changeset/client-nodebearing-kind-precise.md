---
"@nikscripts/effect-pm": minor
---

**Node-bearing auto-connect + kind-precise Tags** — `Resource.client(Hosted)` fully wires when `{ node }` is an `AddressedNode` (same gate as `client(Tag, Worker)`). `Node.Tag` / `Lookup` / `Prototype.make` overloads narrow `kind` from ports (`"Http"`), `ws(s)://` (`"WebSocket"`), and explicit `{ kind }`. New export: `InvalidHttpTarget` (bad http target — Layer/Effect channel; see `invalid-http-target-layer-fail`).
