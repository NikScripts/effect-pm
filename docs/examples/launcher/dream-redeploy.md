{#launcher-dream-redeploy title="Launcher — dream redeploy (Shape β forward + activate)" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/launcher-dream-redeploy>.
<!-- docs-site-link:end -->
# Launcher — dream redeploy (Shape β)

{.draft}
**Draft** — stable public Http + Unix A/B backends + `Node.activate`. File-swap
proves the OS loaded v2. Update.plan/`restartSuccessor` dual-port cutover is **not**
this recipe (Update API parked). Address dock:
[`node-addresses-and-update-api.md`](../../handoffs/node-addresses-and-update-api.md).

**Source:** [`examples/launcher/dream-redeploy.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/launcher/dream-redeploy.ts)  
**Workers:** [`dream-redeploy-worker.v1.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/launcher/dream-redeploy-worker.v1.ts) · [`dream-redeploy-worker.v2.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/launcher/dream-redeploy-worker.v2.ts)  
**Shared:** [`dream-redeploy-shared.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/launcher/dream-redeploy-shared.ts)  
**Run:** `pnpm run example:launcher-dream-redeploy`  
**Suite:** `test/launcher-dream-redeploy.test.ts`  
**Hub:** [Examples → launcher](/docs/examples#launcher)

> [!NOTE]
> **Related:** [forward-proxy](../../../examples/node/forward-proxy/) · [Update guide](/docs/update) (parked for β) · [addresses dock](/docs/…)

## What this shows

```
clients ──Http──►  edge (Node.forward, stable Worker)
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
       A (Unix, v1)            B (Unix, v2)
```

1. Copy v1 onto `dream-redeploy-worker.active.ts`
2. Edge in the orchestrator binds public Http; `Node.forwardAll` → Active label
3. `Launcher.up(A)` loads active (v1) on Unix A
4. `Hyperlink.client(Probe, Worker)` → tip `"v1"` (stable dial)
5. Enqueue WorkPool jobs on Unix A (direct — WorkPool+`forwardAll` still a gap)
6. File-swap active → v2; `Launcher.up(B)` loads v2 on Unix B
7. Move pending A→B over direct Unix (**interim** — Directory is one row; S14 later)
8. `Node.activate(WorkerPrivate, "B")` → tip `"v2"`; public Probe dial never rebinds
9. Release exact payloads from B

## Identity (public / private)

```ts
class Worker extends Node.make(WORKER_NODE_KEY, Address.http(`:${httpPort}`)) {}

class WorkerPrivate extends Worker.pipe(
  Address.unix({ A: sockA, B: sockB }),
  NodePolicy.proxy("Prefer"),
) {}
```

One `Node.make` per identity. Process roles use `Node.withPolicy` — never a second make.

## Roles

```ts
const edge = Node.withPolicy(
  WorkerPrivate,
  NodePolicy.listen("Primary"),
  NodePolicy.active("A"),
  NodePolicy.advertise("Primary"),
)
const backendA = Node.withPolicy(
  WorkerPrivate,
  NodePolicy.as("A"),
  NodePolicy.listen(["A"]),
)
```

Edge owns Directory’s primary Http row. Backends listen labeled Unix only (their dial
is not in the Primary advertise set).

{.twoslash include="examples/launcher/dream-redeploy.ts"}
``` ts
// @noErrors
```
