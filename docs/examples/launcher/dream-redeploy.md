{#launcher-dream-redeploy title="Launcher — dream redeploy (file-swap v1→v2)" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/launcher-dream-redeploy>.
<!-- docs-site-link:end -->
# Launcher — dream redeploy (file-swap v1→v2)

{.draft}
**Draft / provisional** — proves today’s Eng’d mechanics (file-swap + sticky + WorkPool
handoff). **Not the desired SSOT.** `Launcher.restartSuccessor({ target, successor, tags, … })`
is under redesign; address model (main + additional A/B, optional proxy) is design-only.
See [`docs/handoffs/node-addresses-and-update-api.md`](../../handoffs/node-addresses-and-update-api.md).

**Source:** [`examples/launcher/dream-redeploy.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/launcher/dream-redeploy.ts)  
**Workers:** [`dream-redeploy-worker.v1.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/launcher/dream-redeploy-worker.v1.ts) · [`dream-redeploy-worker.v2.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/launcher/dream-redeploy-worker.v2.ts)  
**Shared:** [`dream-redeploy-shared.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/launcher/dream-redeploy-shared.ts)  
**Run:** `pnpm run example:launcher-dream-redeploy`  
**Suite:** `test/launcher-dream-redeploy.test.ts`  
**Hub:** [Examples → launcher](/docs/examples#launcher)

> [!NOTE]
> **Related examples:** [restartSuccessor live A→B](/docs/launcher-restart-successor) · [Policy lookup cutover](/docs/node-policy-lookup-cutover) · [A→B handoff cutover](/docs/node-handoff-ab-cutover)  
> **Guide:** [Launcher](/docs/launcher) · [Policy](/docs/policy) · [Identity coordinator — A→B](/docs/identity-coordinator#ab-cutover-recipe-state-transfer)

## What this shows

End-to-end **binary update** without a Redirect SDK:

1. Copy v1 onto `dream-redeploy-worker.active.ts`; `Launcher.up(A)` loads that file
2. Sticky `lookupClient` reads `Probe.tip === "v1"`; enqueue WorkPool jobs on A
3. **File-swap** the same active path to v2 (A keeps v1 in memory)
4. `Launcher.restartSuccessor` ups B from the swapped path (loads v2), prefers B, shuts A
5. Directory dial moves (same `nodeKey`); sticky tip becomes `"v2"`
6. WorkPool pending transfers with **exact** payloads (baked `releaseEnqueueHandoff`)

## API recipe

Imports (orchestrator):

```ts
import * as Directory from "hyperlink-ts/Directory"
import * as Hyperlink from "hyperlink-ts/Hyperlink"
import * as Launcher from "hyperlink-ts/Launcher"
import * as Lookup from "hyperlink-ts/Lookup"
import * as Node from "hyperlink-ts/Node"
import * as Policy from "hyperlink-ts/Policy"
import * as WorkPool from "hyperlink-ts/WorkPool"
```

### 1. Stable wire Tags across the tip change

Same `nodeKey` + same Tag ids for A and B. Only the **Probe tip** (or other app logic)
differs between binaries:

```ts
export const WORKER_NODE_KEY = "examples/dream-redeploy/Worker"

export const Job = Schema.Struct({ id: Schema.String, note: Schema.String })

export class Jobs extends WorkPool.Tag<Jobs>()(
  "examples/dream-redeploy/Jobs",
  { payload: Job },
) {}

export class Probe extends Hyperlink.Tag<Probe>()(
  "examples/dream-redeploy/Probe",
  { tip: Hyperlink.effect(Schema.String) },
) {}
```

### 2. Worker binaries — v1 vs v2

Both serve `Jobs` (deferred start so pending can hand off) + `Probe`. Difference is the tip:

```ts
// v1
Hyperlink.serve(Probe, { tip: Effect.succeed("v1") })

// v2 — same Tag id; swapped file proves the OS loaded the new binary
Hyperlink.serve(Probe, { tip: Effect.succeed("v2") })
```

Custody / dial-replace on the child:

```ts
Node.http(
  node,
  [
    WorkPool.serve(Jobs, { effect: () => Effect.void }).pipe(
      Hyperlink.deferStart,
    ),
    Hyperlink.serve(Probe, { tip: Effect.succeed("v1" /* or "v2" */) }),
  ],
  {
    assumeToken: token,
    onConflict: "askIncumbent",
    onYield: Effect.succeed(true),
  },
).pipe(Layer.provide(Lookup.clientOptions({ path: lookupSock })))
```

`askIncumbent` + yield lets B take the same Directory `nodeKey` when A drains.

### 3. File-swap the entry the OS will spawn

Keep the active path **in-repo** next to the v1/v2 sources (relative `../../src`
imports break if you copy to `/tmp`):

```ts
const active = `${launcherDir}/dream-redeploy-worker.active.ts`

yield* fs.copyFile(v1Src, active) // before up(A)
// …
yield* fs.copyFile(v2Src, active) // update on disk; A still runs v1 in memory
```

Child command always points at **active** (not at v1/v2 directly):

```ts
const child = (port: number) =>
  Launcher.command(
    "pnpm",
    ["exec", "tsx", active, String(port), lookupPath],
    { cwd: root, stdout: "inherit", stderr: "inherit", token: "env" },
  )
```

### 4. Sticky `lookupClient` (build after Directory has a row)

```ts
const cutover = Policy.make({
  Sticky: true,
  ColdAmbiguous: "fail",
  StreamGap: "stall",
})

// Wait until A is Directory-visible first — ColdAmbiguous:"fail" otherwise
// throws LookupClientError on cold N=0 / ambiguous cold.
yield* waitUntil(Directory.nodesServing(Jobs), (rows) =>
  rows.some((row) => row.nodeKey === WORKER_NODE_KEY && row.url === urlA),
)

const stickyClient = yield* Layer.build(
  Hyperlink.lookupClient(Probe).pipe(
    Policy.provide(cutover),
    Layer.provide(Lookup.client(lookupNode)),
  ),
)

const tipA = yield* Effect.gen(function* () {
  const probe = yield* Probe
  return yield* probe.tip
}).pipe(Effect.provide(stickyClient))
// tipA === "v1"
```

While A is still up, a file-swap alone does **not** move the tip — sticky keeps the
warm dial. Tip moves after `restartSuccessor` stamps `Advice.prefer(B)` and/or A dies.

### 5. Enqueue pending on addressed A

```ts
yield* Effect.gen(function* () {
  const q = yield* Jobs
  yield* q.add([{ id: "1", note: "invoice-a" }, /* … */])
}).pipe(Effect.provide(Hyperlink.client(Jobs, nodeA)), Effect.scoped)
```

### 6. `Launcher.restartSuccessor` — the update API

```ts
const impact = yield* Launcher.restartSuccessor({
  target: WORKER_NODE_KEY, // Directory nodeKey of A
  successor: {
    node: nodeB,           // new dial, same key
    process: child(portB), // spawns active path → now v2 on disk
    ready: { timeout: "25 seconds" },
  },
  tags: [Jobs, Probe],     // what B will serve → Lookup.planUpdate
  // prefer: true (default) — Advice.prefer(B) after up(B), before shutdown(A)
  // incumbent?: [Jobs, Probe] — enables wireRemovals in the plan
  // skipPlan?: true         — ops escape hatch
})
```

Sequence inside `restartSuccessor`:

1. Capture A's Directory dial **before** `up` (same-`nodeKey` would hide A)
2. `Lookup.planUpdate(target, tags)` — fail-closed unless forced / skipped
3. `Launcher.up(B)` — OS loads swapped v2 file
4. `Advice.prefer(B)` per tag (unless `prefer: false`)
5. `Node.shutdown(A)` — WorkPool baked `releaseEnqueueHandoff` moves pending

Provide at the edge:

```ts
program.pipe(
  Effect.scoped,
  Effect.provide(Launcher.layer),
  Effect.provide(Lookup.planStatusOff), // or planFailClosed / planForce
  Effect.provide(lookupCtx),            // Lookup server + client
)
```

### 7. Prove the dial + tip + payloads

```ts
// Directory: one row, same nodeKey, B's URL
yield* waitUntil(
  Directory.nodesServing(Jobs),
  (rows) =>
    rows.length === 1 &&
    rows[0]?.nodeKey === WORKER_NODE_KEY &&
    rows[0]?.url === urlB,
)

// Sticky facade moved — same Layer, new tip
const tipB = yield* waitUntil(
  Effect.gen(function* () {
    const probe = yield* Probe
    return yield* probe.tip
  }).pipe(Effect.provide(stickyClient)),
  (tip) => tip === "v2",
)

// Exact pending on B
const released = yield* Effect.gen(function* () {
  const q = yield* Jobs
  return yield* q.release({})
}).pipe(Effect.provide(Hyperlink.client(Jobs, nodeB)), Effect.scoped)
```

## Who owns what

| Concern | API |
|---------|-----|
| Membership / dial truth / dry-run | `Lookup` + `Directory` + `Lookup.planUpdate` |
| Custody / spawn / exclusive bind | `Launcher.up` / `Launcher.restartSuccessor` |
| Sticky dual-serve + stream seam | `Policy.make({ Sticky, StreamGap, … })` on `lookupClient` |
| Early move while A still up | `Advice.prefer(B)` (default inside `restartSuccessor`) |
| Pending WorkPool migration | baked `releaseEnqueueHandoff` on `Node.shutdown(A)` |
| Live dial census / at-risk clients | `Dialers` (`planUpdate.clientsAtRisk`) |

Not a separate Redirect module — sticky + Advice + build-then-swap is the v1 story.
See [Policy](/docs/policy) and [Launcher — dual-serve](/docs/launcher#dual-serve-engd--sticky--advice-not-a-redirect-module).

## Full orchestrator

{.twoslash include="examples/launcher/dream-redeploy.ts"}
``` ts
// @noErrors
```
