---
"@nikscripts/effect-pm": minor
---

**`Resource.client(tag, host)` — read a hostless multi-host tag as a client.** A hostless `multiHost`
tag is N instances (one per host), so the client now names *which* one: `Resource.client(FleetDatabase,
NwslHost).pipe(Layer.provide(connectHttp(NwslHost)))`. The transport resolves from that host service
(like a host-bound tag), so the returned layer **requires the host** — satisfied by `connectHttp` — and
the requirement is enforced at compile time.

Before, a hostless tag only had `Resource.client(tag)`, which needs the *ambient* `RpcClient.Protocol`;
wiring it to a host service (`connectHttp(host)`, the natural thing) left `RpcClient.Protocol`
unsatisfied and failed at runtime with `Service not found: effect/rpc/RpcClient/Protocol`. The new
overload turns that runtime crash into a compile-time requirement — there's no way to wire it wrong.
Client construction has no error channel and never dies; only the resulting method calls carry typed
errors. Host-bound tags are unchanged (still `Resource.client(tag)`).

This unblocks a browser/dashboard client for multi-host resources. Closes the multi-host SSOT's open
question ("with no host on the tag, how does `Resource.client` name the host?").
