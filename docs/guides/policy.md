{#policy title="Policy" status="stable" done="api" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/policy>.
<!-- docs-site-link:end -->
# Policy — composable cutover, verify, conflict, yield

Client and advertise behaviour as **Layer fragments** on `hyperlink-ts/Policy`. Compose with
`Policy.provide` / `Policy.layer` — nothing stamped onto every Node by default. Call-site
`ListenOptions` / Node `onConflict` stamps remain overrides that win over ambient Policy.

```ts
import * as Policy from "hyperlink-ts/Policy"
import * as Hyperlink from "hyperlink-ts/Hyperlink"
import * as Lookup from "hyperlink-ts/Lookup"

Hyperlink.lookupClient(Mail).pipe(
  Policy.provide(
    Policy.sticky,
    Policy.streamGap("stall"),
    Policy.verifyOff, // only when you need it (bootstrap / nested dials)
  ),
  Layer.provide(Lookup.layer),
)
```

Zero-arg fragments are **values** (`Policy.sticky`, not `Policy.sticky()`). Fragments that need
a mode keep the call: `Policy.streamGap("stall")`.

Runnable demo: [`examples/node/policy-lookup-cutover.ts`](../../examples/node/policy-lookup-cutover.ts)
(`pnpm run example:node-policy-lookup-cutover`).

## Fragments

### Dial / cutover (`lookupClient`)

| Fragment | Default | Meaning |
|----------|---------|---------|
| `Policy.sticky` / `unsticky` | sticky **on** | Warm N&gt;1, no Advice → keep current dial |
| `Policy.streamGap("stall"\|"drop"\|"buffer")` | `"stall"` | One outer Stream across dial swap |
| `Policy.coldAmbiguous("fail"\|"pickFirst"\|"waitAdvice")` | `"fail"` | Cold N&gt;1 without Advice |
| `Policy.pick("first"\|fn)` | unset | Soft pick before cold rule |

**Resolve order** for `Hyperlink.lookupClient(Tag)`:

1. Identity `resolve` (ignores Policy / Advice / pick)
2. Directory `nodesServing`
3. Live `Advice.prefer` matching a row
4. Warm sticky keep-current (if still Directory-visible)
5. `Policy.pick` / call-site `{ pick }`
6. `Policy.coldAmbiguous`

Advice early-move: `import * as Advice from "hyperlink-ts/Advice"` — prefer flips rebind **before**
A leaves / before the first transport error. Effect RPCs retry once on `RpcClientError`. Streams /
`ref.changes` follow dial generations as **one** outer Stream (seam mode from `streamGap`).

### Directory `peersLayer` (same dial story)

Directory-mode `Hyperlink.peersLayer(Tag, ThisNode)` shares Track D parity with `lookupClient`:
build-then-swap peer dials, one `RpcClientError` retry, stable `peers[nodeKey]` facade, streams
under `Policy.streamGap`. Compose Policy on the peers layer the same way:

```ts
Hyperlink.peersLayer(Pool, East).pipe(
  Policy.provide(Policy.streamGap("stall")),
  Layer.provide(Lookup.client(lookupNode)),
)
```

Runnable: [`examples/node/peers-layer-rebind.ts`](../../examples/node/peers-layer-rebind.ts)
(`pnpm run example:node-peers-layer-rebind`). Membership push notes:
[Identity coordinator](/docs/identity-coordinator#custody-vs-membership-launcher--lookup).

### `Lookup.follow` (same address, Lookup A→B)

`Lookup.client` is a **static** dial. `Lookup.follow(lookupNode)` is the hot dialer for **one**
Lookup address across an orchestrated ownership move (A releases sock → B binds the same path).
Dialers never track two Lookup endpoints — compose gap Policy only:

```ts
Lookup.follow(lookupNode).pipe(
  Policy.provide(Policy.streamGap("stall")),
)
```

Effect RPCs retry on `RpcClientError` while reinstalling to the same seed; streams follow dial
generations under `streamGap`. Orchestration (who binds the sock) is outside Policy — see
[Launcher](/docs/launcher) and the decisions handoff.

### Client verify (addressed `Hyperlink.client`)

| Fragment | Mode |
|----------|------|
| `Policy.verifyReject` | `"reject"` (default) — Layer fails on probe error |
| `Policy.verifyStatus` | `"status"` — probe soft |
| `Policy.verifyOff` | skip probe |
| `Policy.verify(mode)` | sugar for any of the above |

See [Client verify](/docs/client-verify). Nested Lookup / status dials use `verifyOff` internally.

### Advertise conflict

| Fragment | Wire preference |
|----------|-----------------|
| `Policy.livenessReplace` | ping replace |
| `Policy.askIncumbent` | cooperative yield |
| `Policy.conflictReject` | alive → reject |
| `Policy.conflictInherit` | continue chain (ambient default) |
| `Policy.onConflict(mode)` | sugar for any of the above |

Types + `Policy.resolveOnConflict` live here; `Node` / `Lookup` re-export them. Resolve for
advertise: call-site `ListenOptions.onConflict` → Node stamp → ambient `Policy.Conflict` →
Lookup stamp → hard `livenessReplace`.

### Yield (`askIncumbent`)

| Fragment | Handler |
|----------|---------|
| `Policy.yieldAccept` | `true` (default) |
| `Policy.yieldRefuse` | `false` |
| `Policy.onYield(effect)` | custom `Effect<boolean>` |

`ListenOptions.onYield` wins when set. While `phase: "draining"`, yield **always refuses**.

## Compose

```ts
const cutover = Policy.layer(
  Policy.sticky,
  Policy.streamGap("stall"),
  Policy.askIncumbent,
  Policy.yieldAccept,
)

Hyperlink.lookupClient(Mail).pipe(
  Policy.provide(cutover),
  Layer.provide(Lookup.layer),
)

Node.unix(Worker, serves).pipe(
  Policy.provide(cutover, Policy.verifyOff), // last write wins per reference
  Layer.provide(Lookup.client(lookupNode)),
)
```

## Cutover recipe (clients)

1. Start Lookup; start **B** so Directory has a target.
2. Dialers use `lookupClient` (defaults: sticky + stream stall + cold fail).
3. Optionally `Advice.prefer(Tag, bNodeKey)` so dialers move **before** A dies.
4. Dual-serve window: A+B both advertised — sticky keeps current until prefer / death.
5. `Node.shutdown(A)` / handoff — see [Identity coordinator — A→B](/docs/identity-coordinator#ab-cutover-recipe-state-transfer).

## Sibling Tags (not under Lookup)

```ts
import * as Advice from "hyperlink-ts/Advice"
import * as Directory from "hyperlink-ts/Directory"
import * as Identity from "hyperlink-ts/Identity"

yield* Advice.prefer(Mail, "fleet/Mail#w2")
yield* Directory.nodesServing(Mail)
yield* Advice.changes.pipe(Stream.runDrain)
```

Never `import { Advice } from "hyperlink-ts/Lookup"` / `Lookup.Advice.*`.

## See also

- [Identity coordinator](/docs/identity-coordinator) — Lookup planes + A→B handoff
- [Fleets & Peers](/docs/fleets-and-peers) — fixed vs Directory membership
- [Client verify](/docs/client-verify) — probe ladder
- [Launcher](/docs/launcher) — custody vs membership
- Examples: [Policy lookup cutover](/docs/node-policy-lookup-cutover) ·
  [peersLayer rebind](/docs/node-peers-layer-rebind) ·
  [askIncumbent takeover](/docs/node-ask-incumbent-takeover) ·
  [drain yield refuse](/docs/node-drain-yield-refuse) ·
  [A→B handoff cutover](/docs/node-handoff-ab-cutover)
