{#launcher title="Launcher" status="draft" done="api" appliesTo=node}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://hyperlink.cool/docs/launcher>.
<!-- docs-site-link:end -->
# Launcher — spawn, Ready, handoff, exit

Short-lived **custody** bring-up for Node. Spawn an OS child, wait until it is **Ready**,
ack ownership with `Node.assume`, then exit. The child keeps running under its own custody.

```text
Launcher.spawn → Handle.awaitReady → Handle.handoff → launcher exits
                 (or Launcher.up = all three)
```

Consume: `import * as Launcher from "hyperlink-ts/Launcher"`.

Handoff brief (tracks A–D): [`docs/handoffs/launcher-and-handoff-brief.md`](../handoffs/launcher-and-handoff-brief.md).
Membership after assume: [Identity coordinator — custody vs membership](./identity-coordinator.md#custody-vs-membership-launcher--lookup).

## What Launcher is (and is not)

| Is | Is not |
|----|--------|
| OS process custody (spawn / Ready / assume / exit) | Lookup / directory membership |
| Node-platform (`ChildProcessSpawner` + `Scope`) | Browser / wire-portable spawn |
| Stable **addressed** `SpawnSpec.node` | Nameless discovery / blank-worker assign |
| Ready = served HyperServices ready (reuse node status) | “Process started” alone |

## Minimal recipe

```ts
import * as Launcher from "hyperlink-ts/Launcher"
import * as Node from "hyperlink-ts/Node"
import { Effect, Layer } from "effect"
import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner"
import * as NodeServices from "@effect/platform-node/NodeServices"

const worker = Node.Tag()("app/Worker", {
  url: "http://127.0.0.1:4100/rpc",
  kind: "Http",
})

const program = Launcher.up({
  node: worker,
  process: Launcher.command("node", ["./worker.js"]), // injects HYPERLINK_ASSUME_TOKEN
}).pipe(
  Effect.scoped,
  Effect.provide(
    Layer.provideMerge(NodeChildProcessSpawner.layer, NodeServices.layer),
  ),
)
```

Child listen must arm assume with the same token (`ListenOptions.assumeToken`, or
`Node.assumeTokenConfig` / `HYPERLINK_ASSUME_TOKEN`). `Launcher.command` defaults to
`token: "env"`; use `"argv"` / `"both"` when the child reads the token from argv.

## Handle phases

| Phase | API | Notes |
|-------|-----|-------|
| Spawned | `Launcher.spawn(spec)` | Mints CSPRNG token (`Redacted` + `Encoding.encodeHex`); starts the OS child |
| Ready | `handle.awaitReady()` | `Schedule.spaced` poll (Config/`ready.poll`) + 2s per dial; outer bound Config/`ready.timeout` |
| Handed off | `handle.handoff()` | `Node.assume({ token })`, then `unref` so the launcher scope may close |

- `awaitReady` / `handoff` are **single-flight** (`Semaphore`) — concurrent calls serialize.
- `awaitReady` is idempotent once Ready.
- `handoff` before Ready → `HandleNotReady`.
- Second `handoff` / `awaitReady` after handoff → `HandleSpent`.
- Child dies during Ready wait → `ChildExited` (`Effect.raceFirst` vs poll).
- Outer wait expires → `ReadyTimedOut`.

Optional `ready.services` waits on a named HyperService subset instead of all served services.

**Config (auto-read when omitted on the spec):**

| Config | Env | Default |
|--------|-----|---------|
| `Launcher.readyTimeoutConfig` | `HYPERLINK_LAUNCHER_READY_TIMEOUT` | `30 seconds` |
| `Launcher.readyPollConfig` | `HYPERLINK_LAUNCHER_READY_POLL` | `100 millis` |

**Token injection helper:**

```ts
process: Launcher.command("node", ["./worker.js"])                 // env (default)
process: Launcher.command("node", ["./worker.js"], { token: "argv" })
process: Launcher.command("pnpm", ["exec", "tsx", entry], { cwd, token: "both" })
```

## Errors (typed)

| Tag | When |
|-----|------|
| `ReadyTimedOut` | Ready poll bound expired |
| `ChildExited` | OS child exited during `awaitReady` |
| `HandleNotReady` | `handoff` before Ready |
| `HandleSpent` | Control after handoff |
| `AssumeTokenMismatch` / `AssumeTokenReused` / `AssumeNotReady` | From `Node.assume` |
| Reachability | `NodeUnreachable` / `UnaddressedNode` / protocol readiness errors |

Assert on `_tag`, not message strings. Messages exist for operators / logs.

## Observability

Phases use Effect **log spans** and **OTEL spans** (`launcher.spawn` / `launcher.awaitReady` /
`launcher.handoff`) with annotations `launcher.node`, `launcher.phase`, (on spawn)
`launcher.pid`, and (on Ready) `launcher.ready_ms`. Effect **metrics**:
`launcher_ready_duration_ms`, `launcher_ready_timeout_total`, `launcher_child_exited_total`,
`launcher_handoff_total{launcher.outcome}`. Assume dial / server paths use `node.assume` —
**never** the token.

Provide an Effect log / tracer / metric reader at the app edge if you want these collected.

## Custody vs membership

After handoff, registration is the **child’s** job (`Lookup.client` / advertise). Launcher
does not call Lookup. Parent checks membership with `Lookup.nodesServing(Jobs)` (Tag or
wire key) — sugar over Directory’s schema’d request. See:
[`examples/forms/hyperlink/launcher-lookup-membership.ts`](../../examples/forms/hyperlink/launcher-lookup-membership.ts).

## Deferred (not beta Launcher)

- Zero-downtime move / drain / version skew (Track C)
- Client-side reconnect story (Track D)
- Blank worker + remote assign; HTTP/WS Lookup; nameless Launcher discovery
