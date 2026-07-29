{#daemon-layer-store-auto-write title="Daemon — Soft store auto-write" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/daemon-layer-store-auto-write>.
<!-- docs-site-link:end -->
# Daemon — Soft store auto-write

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/forms/daemon-store/daemon-layer-store-auto-write.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/forms/daemon-store/daemon-layer-store-auto-write.ts)  
**Run:** `pnpm run example:daemon-layer-store-auto-write`  
**Hub:** [Examples → Daemon Store](/docs/examples#daemon-store)  
**Guides:** [Daemon](/docs/daemons) · [Stores](/docs/stores)

## What this form shows

`Daemon.layer` persists terminal ticks when the tag is registered on an app `Store.Service`
via **`Daemon.store(tag)`**. Soft-default memory storage applies until you
`Layer.provideMerge(DemoStore.layerMemory)` — one AppStore, not a second journal.

`success` on the tag types `Completed.success`. The page fence is the runnable `.ts` file;
cuts hide the module header and `runNodeProgramOrExit` harness.

{.twoslash include="examples/forms/daemon-store/daemon-layer-store-auto-write.ts"}
``` ts
```
