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
Runnable form: [`examples/forms/hyperlink/node-identity-coordinator.ts`](../../examples/forms/hyperlink/node-identity-coordinator.ts).

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
const listen = Context.get(workerBCtx, Node.ListenNode)
yield* Lookup.prefer(Worker, listen.key) // sugar over Lookup.advise
```

Last write wins. Stale prefer (node not in `Lookup.nodesServing(Worker)`) is ignored.
Directory queries use the same sugar style: `yield* Lookup.nodesServing(Jobs)` (Tag or
wire key) — wire payload stays `NodesServingRequest` (`serviceKey`).

### 4. Dial hands

```ts
Hyperlink.lookupClient(Worker) // honors live Advice; else D4 { pick } / fail-closed
// or
Hyperlink.lookupClient(Worker, { pick: "first" })
```

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
- Directory-row replace: `onConflict: "askIncumbent"` + optional `ListenOptions.onYield`
  (`false` refuses). While `Node.drain` / `shutdown` has set `phase: "draining"`, yield
  **always refuses** (draining ≠ dead; Directory row held).
- **Leave / exit:** `Node.shutdown(node)` = drain → Advice clear → Directory unregister →
  listen exit. Prefer `Node.launch(node, listenLayer)` over bare `Layer.launch` so shutdown
  ends the process (no `process.exit`).
- **Membership push / peers:** directory-mode `Hyperlink.peersLayer` **hot-rebinds** on
  `Directory.changes` (dial move / join / leave). Escape hatch: `Lookup.changes` /
  `directoryTable()`. `lookupClient` rebind is still a follow-up.

Runnable: [`examples/forms/hyperlink/launcher-lookup-membership.ts`](../../examples/forms/hyperlink/launcher-lookup-membership.ts).
Custody API: [`docs/guides/launcher.md`](./launcher.md).

## What not to build

- Do **not** invent `Hyperlink.Manager` — identity + directory + advice is the pattern.
- Do **not** put Lookup bootstrap inside protocol listen options — pipe `Layer.provide`.
- Do **not** blank-worker / remote-assign layers from Lookup — entry chooses capabilities;
  Lookup arbitrates membership.
