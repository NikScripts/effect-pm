{#view-data title="View compose data (retired)" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/view-data>.
<!-- docs-site-link:end -->
# View compose data (retired)

`View.compose().data` / `ui.data` is **removed**.

Observe with [Observe recipes](/docs/observe):

```ts
import * as Observe from "hyperlink-ts/Observe"
import * as WorkPoolView from "hyperlink-ts/ui/WorkPoolView"

const box = Observe.use(Jobs, WorkPoolView.pack)
```

See also [Bundles](/docs/bundles) (retirement map).
