{#identity-coordinator title="Identity coordinator" status="stable" done="api" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/identity-coordinator>.
<!-- docs-site-link:end -->
# Identity coordinator — one brain, many hands

Exclusive HyperServices claim at Lookup. Workers advertise. The winning brain can publish
placement advice. Clients dial through Lookup — no `Hyperlink.Manager`.

Handoff SSOT: [`docs/handoffs/identity-coordinator.md`](../handoffs/identity-coordinator.md).
Runnable form: [`examples/node/identity-coordinator.ts`](../../examples/node/identity-coordinator.ts).

## The picture

```text
Lookup
  Identity  →  Router (only one live winner)
  Directory →  Worker#w1, Worker#w2, …
  Advice    →  prefer Worker#w2 right now
```

Same `yield* Router` / `yield* Worker` everywhere. Winner serves; losers become clients of
the winner; hands come and go; Lookup stays the truth.

## Recipe

### 1. Stamp the brain

```ts
class Router extends Hyperlink.Tag<Router>()("fleet/Router", {
  enqueue: Hyperlink.effectFn({ job: Job }, Schema.Void),
}).pipe(Hyperlink.identity) {}
```

`Hyperlink.identity` makes `layer` / `serve` claim `fleet/Router` at Lookup. First live
claimant serves; later claimants dial the winner. Dead winners are replaceable (Node.status
ping).

### 2. Hold Lookup; pipe it on listens

```ts
yield* Layer.build(Lookup.layerOptions({ path: lookupSock, unlink: true }))
const lookup = Lookup.clientOptions({ path: lookupSock })

Node.unix(RouterNode, [Hyperlink.serve(Router, impl)]).pipe(Layer.provide(lookup))
Node.unix([Hyperlink.serve(Worker, impl)]).pipe(Layer.provide(lookup)) // advertise
```

Lookup stays **pipe-only** on listens — never bake `lookupPath` into listen options.

### 3. Publish prefer (optional, M5)

```ts
import * as Advice from "hyperlink-ts/Advice"
import * as Directory from "hyperlink-ts/Directory"

const listen = Context.get(workerBCtx, Node.ListenNode)
yield* Advice.prefer(Worker, listen.key) // sibling module — not Lookup.Advice
```

Last write wins. Stale prefer (node not in `Directory.nodesServing(Worker)`) is ignored.
Directory queries: `yield* Directory.nodesServing(Jobs)` (or Lookup’s re-exported sugar).

### 4. Dial hands

```ts
import * as Policy from "hyperlink-ts/Policy"

// Defaults: sticky dual-serve, stream stall, cold fail-closed
Hyperlink.lookupClient(Worker).pipe(Layer.provide(Lookup.layer))

// Explicit cutover bundle + soft pick
Hyperlink.lookupClient(Worker).pipe(
  Policy.provide(Policy.sticky, Policy.pick("first")),
  Layer.provide(Lookup.layer),
)
```

Full fragment table: [Policy](/docs/policy).

## When identity fails closed

`IdentitySelfRequired` means the Tag is identity-stamped but the layer graph is missing
**Lookup.Identity** and/or a **dialable self**:

1. Provide `Lookup.client` / `Lookup.layer` / `Lookup.layerOptions` (pipe on the listen or layer).
2. Give the Tag a dialable endpoint — `Node.unix` / `http` / `ws` listen (ListenNode) or
   `Hyperlink.nodes([SomeNode])` / Tag-bound `{ path }` Node.

## Custody vs membership (Launcher + Lookup)

Bring-up has two planes — do not collapse them:

```text
Custody    Launcher.up / Node.assume   OS process Ready → self-owned
Membership Lookup Identity/Directory/Advice   who wins / where clients dial
```

- **Launcher** stays custody-only (stable addressed node; exits after assume).
- **Child** pipes `Lookup.client` / `layerOptions` on listen — advertise + identity claim.
- Directory-row replace: `Policy.askIncumbent` (or stamp / `ListenOptions.onConflict`) +
  `Policy.yieldRefuse` / `ListenOptions.onYield` (`false` refuses). While `Node.drain` /
  `shutdown` has set `phase: "draining"`, yield **always refuses** (draining ≠ dead;
  Directory row held).
- **Leave / exit:** `Node.shutdown(node)` = drain → opted-in per-service handoffs
  (serve `{ handoff }`) → Advice clear → Directory unregister → listen exit.
  Prefer `Node.launch(node, listenLayer)` over bare `Layer.launch` so shutdown ends the
  process (no `process.exit`).
- **Per-service handoff (opt-in, default off):** pass a `handoff` fn in the HyperService's
  serve options — `Hyperlink.serve(Tag, impl, { handoff })` (or nest `handoff` in a
  `WorkPool` / `Daemon` / `Gate` config). Signature `(from, to, ctx) => Effect<void | HandoffOutcome>`
  where `from` is the local handle and `to` is a peer client of the same HyperService (dialed from
  the Directory, self excluded by dial). Return `ctx.done` / `void` to leave + shut down, `ctx.retry`
  to re-run (bounded), `ctx.defer` to keep the node up. Any failure / defect — or **no peer** —
  defers: the node restores `phase: "running"` and `Node.shutdown` fails with `HandoffDeferred`
  (`_tag: "HandoffDeferred"`; `.reason` PascalCase — `Defer` | `NoPeer` | `RetryExhausted` |
  `Failed`). Match by `_tag` / `.reason`, never message strings.
  WorkPool queues bake that in via `WorkPool.serve` / `serveRemote` (`releaseEnqueueHandoff`).
- **Membership push / dialers:** directory-mode `Hyperlink.peersLayer` and
  `Hyperlink.lookupClient` **hot-rebind** on Directory membership (dial move / join /
  leave). Escape hatch: `import * as Directory from "…/Directory"` →
  `Directory.changes` / `directoryTable()` (or Lookup’s re-exported sugars).
- **Track D (lookupClient):** build-then-swap dials; Effect RPCs that hit
  `RpcClientError` **retry once** after rebind; sibling-module **`Advice.changes`**
  moves the dial when prefer flips (before A leaves / before the first transport
  error). Keep B Directory-visible. Live streams stay one outer Stream across dial
  swaps (`Policy.streamGap`, default `"stall"`). See [Policy](/docs/policy).

### A→B cutover recipe (state transfer)

Crown-jewel path — **B is Directory-visible before A shuts down** (peer pick excludes self by
**dial**, not `nodeKey`):

1. Start Lookup + **B** serving the HyperService (WorkPool: `autoStart: false` if you want pending
   to stay queued).
2. Start **A** with the same HyperService; enqueue / store state on A.
3. `Node.shutdown(A)` → drain → handoff → Advice clear → unregister → listen exit.
4. Pending / moved state is on B; Directory lists B only; `lookupClient` keeps dialing B when
   Advice / Directory already prefer it (sticky / prefer — [Policy](/docs/policy)).

Same-`nodeKey` variant: `Policy.askIncumbent` + `Policy.yieldAccept` (or stamps) lets B take
the Directory **row** first; A's later `shutdown` still finds B by dial and transfers.
Mid-handoff, draining A **refuses** a further `askIncumbent` yield (`IncumbentAlive`; row held).

**Runnable demos:**
- WorkPool state transfer — [`examples/node/handoff-ab-cutover.ts`](../../examples/node/handoff-ab-cutover.ts)
  (`pnpm run example:node-handoff-ab-cutover`)
- Custom `{ handoff }` / `HandoffDeferred` —
  [`examples/node/serve-handoff.ts`](../../examples/node/serve-handoff.ts)
  (`pnpm run example:node-serve-handoff`)
- Drain + yield refuse —
  [`examples/node/drain-yield-refuse.ts`](../../examples/node/drain-yield-refuse.ts)
  (`pnpm run example:node-drain-yield-refuse`)
- askIncumbent accept / refuse —
  [`examples/node/ask-incumbent-takeover.ts`](../../examples/node/ask-incumbent-takeover.ts)
  (`pnpm run example:node-ask-incumbent-takeover`)
- Client Policy sticky + Advice prefer —
  [`examples/node/policy-lookup-cutover.ts`](../../examples/node/policy-lookup-cutover.ts)
  (`pnpm run example:node-policy-lookup-cutover`)
- peersLayer hot-rebind —
  [`examples/node/peers-layer-rebind.ts`](../../examples/node/peers-layer-rebind.ts)
  (`pnpm run example:node-peers-layer-rebind`)
- `Node.launch` + shutdown —
  [`examples/node/launch-shutdown.ts`](../../examples/node/launch-shutdown.ts)
  (`pnpm run example:node-launch-shutdown`)
- **Watchable Ink TUI** — [`examples/apps/tui/handoff-ab-live.tsx`](../../examples/apps/tui/handoff-ab-live.tsx)
  (`pnpm run example:handoff-ab-live`, real TTY)

Live suites: [`test/handoff-ab-cutover.test.ts`](../../test/handoff-ab-cutover.test.ts),
[`test/policy-lookup-client.test.ts`](../../test/policy-lookup-client.test.ts). Decisions:
[`launcher-and-handoff-brief.md`](../handoffs/launcher-and-handoff-brief.md) Locked #39 / #46.

Runnable: [`examples/launcher/lookup-membership.ts`](../../examples/launcher/lookup-membership.ts).
Custody API: [`docs/guides/launcher.md`](./launcher.md).

## What not to build

- Do **not** invent `Hyperlink.Manager` — identity + directory + advice is the pattern.
- Do **not** put Lookup bootstrap inside protocol listen options — pipe `Layer.provide`.
- Do **not** blank-worker / remote-assign layers from Lookup — entry chooses capabilities;
  Lookup arbitrates membership.

## See also

- [Policy](/docs/policy) — sticky dial, stream gap, verify, conflict, yield
- [Client verify](/docs/client-verify) — addressed-client probe ladder
- [Launcher](/docs/launcher) — custody vs membership
- Example: [Policy lookup cutover](/docs/node-policy-lookup-cutover)
- Example: [A→B handoff cutover](/docs/node-handoff-ab-cutover)
