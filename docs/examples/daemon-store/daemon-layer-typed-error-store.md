{#daemon-layer-typed-error-store title="Daemon — Typed Failed.error" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/daemon-layer-typed-error-store>.
<!-- docs-site-link:end -->
# Daemon — Typed Failed.error

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/forms/daemon-store/daemon-layer-typed-error-store.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/forms/daemon-store/daemon-layer-typed-error-store.ts)  
**Run:** `pnpm run example:daemon-layer-typed-error-store`  
**Hub:** [Examples → Daemon Store](/docs/examples#daemon-store)  
**Guides:** [Daemon](/docs/daemons) · [Stores](/docs/stores)

## What this form shows

When the tag stamps an **`error`** schema, `Daemon.layer` writes typed `Failed.error` rows
through `Daemon.store(tag)`. Same Soft-override pattern as the auto-write form — register once,
`provideMerge` the AppStore into the daemon layer.

{.twoslash include="examples/forms/daemon-store/daemon-layer-typed-error-store.ts"}
``` ts
```
