---
"hyperlink-ts": minor
---

**Served hosts get a `/health` readiness route.** `Resource.serveAllHttp` now mounts an always-on plain HTTP `GET /health` alongside `/rpc` (relocate with `options.health.path`) — a dumb probe (deploy gate, load balancer) gets a status code, and the JSON body (`{ status, listening, resources: [{ key, kind }], uptimeMillis, ts }`) lists what the host serves, for a dashboard health board. This restores the readiness endpoint the removed control plane used to provide. Phase 1 reports `ok` (the server answering proves it's listening) + the resource roster; per-resource readiness (→ `503` when a resource is down), via a uniform `ready` seam folded into `HostStatus`, follows.
