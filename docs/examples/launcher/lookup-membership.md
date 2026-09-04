{#launcher-lookup-membership title="Launcher — Lookup membership" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/launcher-lookup-membership>.
<!-- docs-site-link:end -->
# Launcher — Lookup membership

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/launcher/lookup-membership.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/launcher/lookup-membership.ts)  
**Run:** `pnpm run example:launcher-lookup-membership`  
**Hub:** [Examples → launcher](/docs/examples#launcher)

> [!NOTE]
> **Related examples:** [membership child](/docs/launcher-lookup-membership-child) · [minimal up](/docs/launcher-minimal-up) · [askIncumbent takeover](/docs/node-ask-incumbent-takeover) · [identity coordinator](/docs/node-identity-coordinator)  
> **Guide:** [Launcher — custody vs membership](/docs/launcher#custody-vs-membership) · [Identity coordinator](/docs/identity-coordinator)

## What this shows

Two planes: **Launcher** finishes custody (`up` / `Node.assume`), then the **child** pipes
`Lookup.client` and appears in Directory. Parent verifies with `nodesServing` — Launcher
never calls Lookup itself.

Child stamps `onConflict: "askIncumbent"` + `onYield: false` (refuse steal) while holding
the key — see [askIncumbent takeover](/docs/node-ask-incumbent-takeover) for accept.

{.twoslash include="examples/launcher/lookup-membership.ts"}
``` ts
```
