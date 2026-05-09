# Deploy-Time Peer Coordination

## Overview

This feature is lower priority than the state restructure and schedule switching — no current services require singleton enforcement, and a temporary home server can cover downtime during redeploys. It is documented here so the design is captured alongside the other features and can be built in parallel where DX and types are concerned.

For the full blue/green deploy context, infrastructure details, and deploy flow, see the separate deploy guide. This document covers only what effect-pm needs to implement.

---

## What effect-pm Needs to Provide

1. An optional `peer` config on `ProcessManager.make`
2. An internal coordination HTTP endpoint (VPC-only, auth-gated)
3. Per-process optional `handoff` config with typed stop/start handlers
4. Startup logic: once healthy, reach out to peer once if configured

The PM is hosting-agnostic. It does not know about DigitalOcean, load balancers, or deploy scripts. It only needs a peer URL and a shared secret in env.

---

## ProcessManager Peer Config

```ts
// Option A — inline on ProcessManager.make
ProcessManager.make({
  peer: {
    url: Config.string("PEER_DROPLET_URL"),
    secret: Config.string("DEPLOY_SECRET"),
  },
  processes: [...]
})
```

```ts
// Option B — separate layer/service provided to the PM
ProcessManager.make({
  processes: [...]
}).pipe(
  Effect.provide(PeerCoordinator.layer({
    url: Config.string("PEER_DROPLET_URL"),
    secret: Config.string("DEPLOY_SECRET"),
  }))
)
```

Option A is simpler. Option B is more compositional and keeps the PM config focused on processes — the coordination concern is a separate layer. Either could work; Option B may age better if the coordinator grows in complexity.

When `peer` config is absent (or env vars are not set), no coordination endpoint is started and no outbound request is made on startup. Single-instance mode is the default with zero overhead.

---

## Startup Sequence with Peer Config

The PM does not poll the peer. Once the app is healthy, it makes a single outbound request:

```
App starts
  → All processes initialize
  → Health endpoint returns 200
  → PM attempts POST /deploy/handoff to peer URL
      → If peer responds: run handoff protocol per process
      → If peer unreachable (no peer running): continue normally
  → After all handoff start handlers complete: POST /deploy/confirm to peer
  → Peer tears down its coordinated processes
```

"Healthy" means Effect layers are built and the health endpoint is returning 200. The exact mechanism for the PM to know this depends on how the health endpoint is wired up — this is worth deciding during implementation.

---

## Coordination Endpoint

The PM exposes a small internal HTTP server (not on the public port). Endpoints:

| Endpoint | Direction | Purpose |
|---|---|---|
| `GET /deploy/status` | peer → this instance | List running processes and handoff readiness |
| `POST /deploy/handoff/:id` | peer → this instance | Trigger stop handler, return serialized state |
| `POST /deploy/confirm` | peer → this instance | New instance is up; this instance can tear down |

All requests are authenticated with the shared secret (e.g. `Authorization: Bearer <secret>`).

The port for the coordination server is separate from the app's main port. It could be a fixed offset, a separate env var, or hardcoded — worth deciding during implementation.

---

## Per-Process Handoff Config

Processes without handoff config are stopped and started normally — no special handling. Only processes that need state transfer or singleton enforcement need `handoff`.

### Option A — `handoff` as a top-level field on the process config

```ts
Process.make({
  id: "queue-worker",
  effect: processQueue,
  schedule: Schedule.fixed("5 seconds"),

  handoff: {
    stop: (ctx) => Effect.gen(function* () {
      yield* ctx.drainCurrentJobs()
      const cursor = yield* ctx.getCurrentCursor()
      return { cursor }
    }),

    stateSchema: Schema.Struct({ cursor: Schema.String }),

    start: (state, ctx) => Effect.gen(function* () {
      yield* ctx.resumeFromCursor(state.cursor)
    }),
  }
})
```

### Option B — `handoff` as a separate builder/wrapper

```ts
Process.make({
  id: "queue-worker",
  effect: processQueue,
  schedule: Schedule.fixed("5 seconds"),
}).pipe(
  Process.withHandoff({
    stop: (ctx) => ...,
    stateSchema: Schema.Struct({ cursor: Schema.String }),
    start: (state, ctx) => ...,
  })
)
```

Option A keeps everything in one place. Option B separates the deploy concern from the process definition, which may be preferable if most processes never use handoff and you want it visually distinct.

### No-state singleton (stop/start only, no data transfer)

For processes that just need to stop before the new instance starts, but have no state to transfer:

```ts
// Option A — explicit void
handoff: {
  stop: () => Effect.void,
  stateSchema: Schema.Void,
  start: () => Effect.void,
}

// Option B — shorthand flag
handoff: "singleton"  // PM handles stop/start with no state
```

Option B is more ergonomic for the common singleton-with-no-state case, but adds a union type to `handoff`. Could offer both.

---

## State Transfer

The state returned by `stop` is:

1. Validated against `stateSchema` (Effect Schema)
2. Serialized to JSON
3. Sent in the `POST /deploy/handoff/:id` response body
4. Received by the new instance
5. Validated against `stateSchema` again on the receiving end
6. Passed to `start`

Both directions validate. This catches schema drift between old and new builds — if the new build changed the state shape, the deserialization fails clearly rather than silently passing corrupt state.

`stateSchema` is required when `handoff` is defined (not optional). This is intentional — untyped state transfer is the failure mode being avoided.

---

## What Stays Out of effect-pm

- Provisioning droplets
- Pulling/building new code
- Adding/removing droplets from the LB
- CI/CD pipeline
- Any DigitalOcean-specific logic

The PM only needs:

```
PEER_DROPLET_URL=http://10.x.x.x:PORT
DEPLOY_SECRET=<shared-secret>
```

Both env vars can always be set. If the peer is unreachable, the outbound handoff request fails gracefully and the PM continues in single-instance mode.
