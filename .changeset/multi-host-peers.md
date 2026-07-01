---
"@nikscripts/effect-pm": minor
---

**Multi-host via `Resource.peers`.** Combined/fleet values are written as **plain queries in the resource layer**, not a special contract field kind: implement e.g. `totalConnections` with `Resource.peers` (the other hosts' clients) + your own value. New surface:

- `Resource.Host("id", { url })` — a host carries its own transport url.
- Declare the fleet as a `Tag` factory option — `Resource.Tag<Database>()("app/Database", spec, { multiHost: [NwslHost, EbwslHost, WnbaHost] })` — hostless, every instance an equal peer (a `Resource.multiHost([...])` pipe combinator also exists for host-bound tags). `Resource.fleet(method)` tags a combined field (served, but excluded from `peers`).
- `Resource.peers(tag)` — the peer clients (other hosts, keyed by host), for a resource's own cross-host logic; fold with `/MultiHost` `combineQuery`/`combineStream` and add your own value.
- `Resource.peersLayer(tag, self)` — the **opt-in mesh**: connect the `multiHost` set (minus self) via each host's url. `Resource.peersFrom(tag, clients)` — provide peers from an explicit client map (a holder's bundles, or a test).

`Resource.layer` / `Resource.server` / `Resource.serveHttp` now let an impl **require a capability** (like `peers`) and discharge it — the served/stored service stays `R = never`, so clients are unaffected. No mesh unless you provide `peersLayer` where the logic reaches across hosts.
