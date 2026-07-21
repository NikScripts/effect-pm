---
"@nikscripts/effect-pm": minor
---

**Default-on client verify (§8.6)** — addressed `Resource.client` / `clientHttp` / `socketClient` probe the peer at layer build.

- Default mode `"reject"` → `NodeUnreachable` when the peer is down.
- Opt out / soften: `Layer.provide(Resource.clientVerify(false | "status"))`.
- `ClientVerify` is a `Context.Reference` (default `"reject"`).
- Relative same-origin `/rpc` URLs are not probed.
