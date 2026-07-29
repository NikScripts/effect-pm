{#nwsl-gate-http-api title="Scenario — NWSL Gate.HttpApiClient" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/nwsl-gate-http-api>.
<!-- docs-site-link:end -->
# Scenario — NWSL Gate.HttpApiClient

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/scenarios/nwslsoccer/gate-http-api-client.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/scenarios/nwslsoccer/gate-http-api-client.ts)  
**Run:** `pnpm run example:nwsl-gate-http-api`  
**Hub:** [Examples → Scenarios](/docs/examples#scenarios)

Fence body `// @noErrors` covers `process.env` / console under the docs Twoslash host; the script still runs live via `pnpm run example:nwsl-gate-http-api`.

## What this scenario shows

Live NWSL SDP client via `Gate.HttpApiClient` (concurrency / rateLimit on the transport). Supporting modules live under `examples/scenarios/nwslsoccer/` — this page pairs the runnable entry, not every schema file.

{.twoslash include="examples/scenarios/nwslsoccer/gate-http-api-client.ts"}
``` ts
// @noErrors
```
