{#configuration title="Configuration" status="draft" appliesTo=all}
# Configuration

How an application declares configuration, and how the parts that change while it runs are swapped safely. This builds on Effect's `Config` — it doesn't replace it, it adds a hot-swap layer on top.

## Hot-swappable config

`DynamicConfig` wraps the `Config` fields that may change at runtime. Reads keep the **native `Config` interface** — `yield* cfg.apiKey` reads through the ambient `ConfigProvider` exactly like any `Config`, with `R = never`. A swap writes a raw override into a store, so the *next* read of that key — through the wrapper or a plain `Config` — sees the new value.

``` ts
import { Config, Effect } from "effect"
import * as DynamicConfig from "@nikscripts/effect-pm/DynamicConfig"

const cfg = DynamicConfig.make({
  baseUrl: Config.string("BASE_URL").pipe(Config.withDefault("https://api.example.com")),
  apiKey: DynamicConfig.swappable(Config.redacted("API_KEY")),
})

const program = Effect.gen(function* () {
  const url = yield* cfg.baseUrl     // read — a native Config
  yield* cfg.apiKey.set("rotated")   // swap — the control lives on the field
  yield* cfg.apiKey.reset            // revert to env / default
})
```

Provide the store once with `layer`, at or above any scope that reads or swaps:

``` ts
program.pipe(Effect.provide(DynamicConfig.layer(cfg)))
```

### Scoped vs. process-wide

A field is made swappable one of two ways, and the choice is about **who may swap it by string** (the `setByKey` path, below):

- **`swappable`** — *scoped*. No global footprint. Its typed control (`.set` / `.reset` / `.changes`) works wherever `layer` is provided; the string path opens for it only in a provision you hand its config to, `layer(cfg)`.
- **`globalSwappable`** — *process-wide*. Declared anywhere (even at module scope), with no wiring, swappable by string on any runtime. Reach for it when a remote/RPC handler does the swapping.

``` ts
// scoped — reachable by setByKey only where layer(cfg) is provided
const cfg = DynamicConfig.make({ token: DynamicConfig.swappable(Config.string("TOKEN")) })

// process-wide — setByKey works on any runtime, no wiring
const apiKey = DynamicConfig.globalSwappable(Config.redacted("API_KEY"))
```

### Swapping by key

`setByKey` swaps a raw env key — the path for an RPC handler that doesn't hold a field. It is gated by the allowlist (a runtime's `globalSwappable` keys, plus any `swappable` keys in the config given to its `layer`) and validates the value before writing it.

``` ts
// inside an RPC procedure on the target runtime:
yield* DynamicConfig.setByKey("API_KEY", "rotated")
// → fails with ConfigKeyNotSwappable if that key was not declared swappable here
```

### Composing and freezing

``` ts
const whole = yield* DynamicConfig.all(cfg)  // read the whole bag at once, like Config.all
const child = DynamicConfig.extend(cfg, {    // clone a bag and add fields
  retries: Config.int("RETRIES").pipe(Config.withDefault(3)),
})
const readonly = DynamicConfig.freeze(cfg)   // .set won't compile against a frozen view
```

{.note}
Hot-swappable config is the first piece of this page — more configuration guidance lands here as the Resources chapters firm up.
