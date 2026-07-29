{#hyperlink-atom title="Hyperlink atom adapters" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://hyperlink.cool/docs/hyperlink-atom>.
<!-- docs-site-link:end -->
# Hyperlink atom adapters

Universal Effect-reactive bindings over a Hyperlink Tag (or a live handle field). Sibling to
`Hyperlink.promise` (Promise/async). Not a Spec leaf: wrap the handle you already have via
`Atom.runtime(layer)`.

```ts
import { Atom } from "effect/unstable/reactivity"
import * as Hyperlink from "hyperlink-ts/Hyperlink"

const rt = Atom.runtime(appLayer)

// Live push (ref / stream only)
const status = Hyperlink.atom(rt)(Jobs, (q) => q.status)
const metrics = Hyperlink.atom(rt)(Jobs, (q) => q.metrics.stream)
const fromHandle = Hyperlink.atom(rt)(handle.status)

// One-shot Effect read
const seed = Hyperlink.query(rt)(Jobs, (q) => q.metrics.query({ limit: 50 }))

// Commands
const pause = Hyperlink.fn(rt)(Jobs, (q) => q.pause)
const add = Hyperlink.fn(rt)(Jobs, (q) => q.add)
```

## Rules

1. **`atom`** = Subscribable or Stream. Nested bags need `.stream` / `.changes` (not `q.metrics` alone).
2. **`query`** = Effect read (refreshable atom).
3. **`fn`** = bare Effect (no-arg) or `(arg) => Effect`.
4. Identity: `q.status` and `q.status.changes` share one atom (channel key from the select path).
5. React apps: put `rt` in `RuntimeProvider`; subscribe with `useAtomValue` / `useAtomSet`.

Dashboard packs compose these via [Observe](/docs/observe) (`WorkPoolView.pack`, …).
See [Bundles](/docs/bundles) for the retirement map from `Bundle.observe`.
