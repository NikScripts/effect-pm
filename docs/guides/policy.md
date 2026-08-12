{#policy title="LookupPolicy" status="stable" done="api" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/policy>.
<!-- docs-site-link:end -->
# LookupPolicy — dial, verify, conflict, yield

Lookup / Directory participation as **Layer fragments** on `hyperlink-ts/LookupPolicy`.
Compose with `LookupPolicy.provide` / `LookupPolicy.layer` — nothing stamped onto every
Node by default. Call-site `ListenOptions` / Node `onConflict` stamps remain overrides
that win over ambient LookupPolicy. Sister module: `hyperlink-ts/NodePolicy` (this-process
address-list knobs).

Built on shared **`hyperlink-ts/PolicyBuilder`**: private plural constructable
`LookupPolicies` declares Schema keys / PascalCase References and camelCase Layer
methods (`Uncapitalize` — `"Sticky"` → `sticky`). This singular module re-exports those
helpers plus mode presets. Apps import the module — not the builder.

```ts
import * as LookupPolicy from "hyperlink-ts/LookupPolicy"
import * as Hyperlink from "hyperlink-ts/Hyperlink"
import * as Lookup from "hyperlink-ts/Lookup"

const cutover = LookupPolicy.make({ Sticky: true, StreamGap: "stall", Verify: "reject" }).pipe(
  LookupPolicy.layer(LookupPolicy.verifyOff),
  LookupPolicy.layer(LookupPolicy.streamGap("buffer")),
)
// LookupPolicy.Policy<{ Sticky: true; StreamGap: "buffer"; Verify: false }>
// LookupPolicy.config(cutover) → { Sticky: true, StreamGap: "buffer", Verify: false }

LookupPolicy.layer(LookupPolicy.sticky, LookupPolicy.streamGap("stall"), LookupPolicy.verifyOff)

Hyperlink.lookupClient(Mail).pipe(
  LookupPolicy.provide(cutover),
  Layer.provide(Lookup.layer),
)
```

`LookupPolicy.make({ … })` stamps a **product** config; `LookupPolicy.layer` merges Layers
**and** configs (pipe or data-first) — not a phantom cast.

Runnable demo: [`examples/node/policy-lookup-cutover.ts`](../../examples/node/policy-lookup-cutover.ts)
(`pnpm run example:node-policy-lookup-cutover`).

## Fragments

### Dial / cutover (`lookupClient`)

| Fragment | Default | Meaning |
|----------|---------|---------|
| `LookupPolicy.sticky` / `unsticky` | sticky **on** | Warm N&gt;1, no Advice → keep current dial |
| `LookupPolicy.streamGap("stall"\|"drop"\|"buffer")` | `"stall"` | One outer Stream across dial swap |
| `LookupPolicy.coldAmbiguous("fail"\|"pickFirst"\|"waitAdvice")` | `"fail"` | Cold N&gt;1 without Advice |
| `LookupPolicy.pick("first"\|fn)` | unset | Soft pick before cold rule |

**Resolve order** for `Hyperlink.lookupClient(Tag)`:

1. Identity `resolve` (ignores Policy / Advice / pick)
2. Directory `nodesServing`
3. Live `Advice.prefer` matching a row
4. Warm sticky keep-current (if still Directory-visible)
5. `LookupPolicy.pick` / call-site `{ pick }`
6. `LookupPolicy.coldAmbiguous`

Advice early-move: `import * as Advice from "hyperlink-ts/Advice"` — prefer flips rebind **before**
A leaves / before the first transport error. Effect RPCs retry once on `RpcClientError`. Streams /
`ref.changes` follow dial generations as **one** outer Stream (seam mode from `streamGap`).

### Directory `peersLayer` (same dial story)

Directory-mode `Hyperlink.peersLayer(Tag, ThisNode)` shares Track D parity with `lookupClient`:
build-then-swap peer dials, one `RpcClientError` retry, stable `peers[nodeKey]` facade, streams
under `LookupPolicy.streamGap`. Compose Policy on the peers layer the same way:

```ts
Hyperlink.peersLayer(Pool, East).pipe(
  LookupPolicy.provide(LookupPolicy.streamGap("stall")),
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
  LookupPolicy.provide(LookupPolicy.streamGap("stall")),
)
```

Effect RPCs retry on `RpcClientError` while reinstalling to the same seed; streams follow dial
generations under `streamGap`. Orchestration (who binds the sock) is outside Policy — see
[Launcher](/docs/launcher) and the decisions handoff.

Runnable: [`examples/node/lookup-follow-handoff.ts`](../../examples/node/lookup-follow-handoff.ts)
(`pnpm run example:node-lookup-follow-handoff`) — fork B bind-retry → release A → follow lands on B.

### Client verify (addressed `Hyperlink.client`)

| Fragment | Mode |
|----------|------|
| `LookupPolicy.verifyReject` | `"reject"` (default) — Layer fails on probe error |
| `LookupPolicy.verifyStatus` | `"status"` — probe soft |
| `LookupPolicy.verifyOff` | skip probe |
| `LookupPolicy.verify(mode)` | sugar for any of the above |

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

### Typed fragments + `LookupPolicy.layer` (dual)

Every fragment is a real `LookupPolicy.Policy<{ … }>` (Layer + stamped config).
`LookupPolicy.layer` is Effect-style `dual`: `.pipe(LookupPolicy.layer(other))` or
`LookupPolicy.layer(a, b, c)`. Configs merge with last write wins — runtime
`LookupPolicy.config(p)` matches the type.

```ts
const cutover = LookupPolicy.make({ Sticky: true, StreamGap: "stall", Verify: "reject" }).pipe(
  LookupPolicy.layer(LookupPolicy.verifyOff),
  LookupPolicy.layer(Policy.askIncumbent),
  LookupPolicy.layer(Policy.yieldAccept),
)
// LookupPolicy.Policy<{
//   Sticky: true
//   StreamGap: "stall"
//   Verify: false
//   Conflict: "askIncumbent"
//   Yield: true
// }>

Hyperlink.lookupClient(Mail).pipe(
  LookupPolicy.provide(cutover),
  Layer.provide(Lookup.layer),
)
```

Data-first:

```ts
const cutover = LookupPolicy.layer(
  LookupPolicy.sticky,
  LookupPolicy.streamGap("stall"),
  Policy.askIncumbent,
  Policy.yieldAccept,
)
```

## Cutover recipe (clients)

1. Start Lookup; start **B** so Directory has a target.
2. Clients use `lookupClient` (defaults: sticky + stream stall + cold fail) — soft-registers on **`Dialers`** for `planUpdate.clientsAtRisk`.
3. `Advice.prefer(Tag, bNodeKey)` (or `Launcher.restartSuccessor` default prefer) so dials move **before** A dies.
4. Dual-serve window: A+B both advertised — sticky keeps current until prefer / death (no Redirect module).
5. `Node.shutdown(A)` / handoff — see [Identity coordinator — A→B](/docs/identity-coordinator#ab-cutover-recipe-state-transfer).

## Sibling Tags (not under Lookup)

```ts
import * as Advice from "hyperlink-ts/Advice"
import * as Dialers from "hyperlink-ts/Dialers"
import * as Directory from "hyperlink-ts/Directory"
import * as Identity from "hyperlink-ts/Identity"

yield* Advice.prefer(Mail, "fleet/Mail#w2")
yield* Directory.nodesServing(Mail)
yield* Dialers.listForTarget("fleet/Mail#w2")
yield* Advice.changes.pipe(Stream.runDrain)
```

Never `import { Advice } from "hyperlink-ts/Lookup"` / `Lookup.Advice.*` (same for Dialers).

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
