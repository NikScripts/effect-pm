{#last-ts-from-effect title="last-ts — fromEffect / groupsFromEffect" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/last-ts-from-effect>.
<!-- docs-site-link:end -->
# last-ts — fromEffect / groupsFromEffect

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/last/from-effect/main.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/last/from-effect/main.ts)  
**Run:** `pnpm run example:last-from-effect`  
**Spine:** [last-ts spine](/docs/last-ts-spine)

## Why this needs `fromEffect`

Static `.add(Route.get("acme"), Route.get("nova"))` hardcodes the partner set into
the catalog module. Here partners and product modules live in **Context services**;
Layers swap demo vs enterprise data and the route table changes — same catalog code.

- `group.fromEffect` — flat endpoints inside one group (`PartnerDirectory` → `/p/*`)
- `groupsFromEffect` — whole flat groups on the catalog (`FeatureModules` → billing / support)

Sync `R=never` Effects still materialize immediately (fileRoot / tooling). Effects
that `yield*` a service defer until `RouterBuilder.layer`.

{.twoslash include="examples/last/from-effect/main.ts"}
``` ts
```
