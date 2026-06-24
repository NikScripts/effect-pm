# Resource Host — health / status (deferred design)

**Status:** design locked, not implemented. Depends on `Resource.Host`, which does not
exist yet. Build this *with* Host when Host lands, not bolted on afterward.

## Context

`src/Resource.ts` is the resource toolkit: schema-defined service tags with
location-transparent layers (`Resource.layer` local, `Resource.client` remote,
`Resource.server` / `Resource.serveInstances` to expose impls over RPC). One `RpcServer`
hosts **many** resource types; procedure wire tags are namespaced by a **group id**
prefix (`queue/pause`, `process/stop`) so unrelated resources can't collide. A
`Resource.Host` (deferred) will hold the connection/transport info a remote resource is
reached through.

## Idea

A host's health surface is **just another resource** served on the same `RpcServer`,
under a **reserved group id** (e.g. `$host`). No special transport code — same
`yield* Host` mechanism as any resource. The existing `claimedGroupIds` guard already
prevents anything squatting the reserved prefix (and group-id validation should reject a
leading `$` so user resources can't claim it).

`Resource.host(...)` auto-mounts this built-in group; the host's client exposes it.

## Procedure set (minimal, high-value)

- **`ping → { now }`** — liveness + RTT. Client measures the round trip; `now` also
  surfaces clock skew. Cheapest "is the transport up."
- **`health → { status: "ok" | "starting" | "degraded"; uptimeMs }`** — readiness vs
  liveness. `starting` = connected but not all layers mounted yet.
- **`inventory → ReadonlyArray<{ groupId; methods }>`** — what this host actually serves.
  **This is the real consumer** for the served-set registry we deferred (see
  `reference_resource_service_factory` memory: "list served resources"). Health/status is
  what justifies building that registry — a dashboard/CLI can ask a host "what do you
  have?" and discover resources with no out-of-band config.
- **`contractHash → string`** (optional, high-leverage) — hash of the merged group's
  contract. Client compares against its own expected hash → **detects client/server
  contract drift before calling a stale procedure**. This is the cross-process
  version-handshake foolproofing item; nearly free once `inventory` exists.

## Client-side conveniences (on top of the raw procedures)

- `Host.waitReady` — poll `health` until `ok`, with a timeout.
- `Host.ping` — return the measured RTT, not raw `now`.

## Open decisions (settle at build time)

- **Reserved prefix** — `$host` vs `@resource/host`. Validate group ids reject the
  reserved sigil so users can't collide.
- **`degraded` semantics** — roll per-resource readiness into `health`, or keep `health`
  coarse and let `inventory` carry per-resource state. Recommend: start coarse, add
  per-resource later.

## Tie-ins

- Served-set registry (`Resource.served`-style query) — deferred until a consumer exists;
  `inventory` is that consumer.
- Contract-version handshake (foolproofing) — `contractHash`.
