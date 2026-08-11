{#node-forward-proxy title="Node — forward-proxy (public / private + activate)" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/node-forward-proxy>.
<!-- docs-site-link:end -->
# Node — forward-proxy (public / private + activate)

{.draft}
**Draft** — in-process Shape β sketch: public `Node.make`, private `Public.pipe`,
`Node.withPolicy` roles, `Node.forward` + `Node.activate`. No Launcher / file-swap.
Full multi-process recipe: [dream redeploy](/docs/launcher-dream-redeploy).

**Sources (all below):**

| File | Role |
|------|------|
| [`shared.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/node/forward-proxy/shared.ts) | Probe + public `Worker` + `WorkerPrivate` |
| [`main.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/node/forward-proxy/main.ts) | Edge / backends / activate / run |

**Run:** `pnpm run example:node-forward-proxy`  
**Hub:** [Examples → node](/docs/examples#node)  
**Dock:** [`node-addresses-and-update-api.md`](../../handoffs/node-addresses-and-update-api.md)

> [!NOTE]
> **Related:** [dream redeploy](/docs/launcher-dream-redeploy) · [Policy lookup cutover](/docs/node-policy-lookup-cutover)

## What this shows

```
clients ──Http──►  edge (Node.forward, stable Worker)
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
       A (Unix)                B (Unix)
```

1. Public `Worker` = client dial only (no A/B on construction)
2. `WorkerPrivate extends Worker.pipe(Address.unix({ A, B }), …)` — same key
3. `withPolicy` for edge / backendA / backendB (never a second make)
4. `Node.activate(…, "B")` retargets without restarting the edge

## 1. Shared — identity

{.twoslash include="examples/node/forward-proxy/shared.ts"}
``` ts
// @noErrors
```

## 2. Main — roles + run

{.twoslash include="examples/node/forward-proxy/main.ts"}
``` ts
// @noErrors
```
