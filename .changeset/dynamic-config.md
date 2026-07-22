---
"hyperlink-ts": minor
---

Add the public `DynamicConfig` module — hot-swappable config on top of Effect `Config`.

Define config the normal way with `Config.*` and wrap fields that may change at
runtime in `DynamicConfig.swappable` — which returns a usable single field on its
own (read it, swap it, no `make` needed). `DynamicConfig.make` groups fields into
a plain bag of yieldable `ConfigField` wrappers, so reads stay the native `Config`
interface (`yield* cfg.apiKey`, `R = never`, any reader — wrapper or raw — sees
swaps) and any field name is allowed (no tag, no `key` collision).
`DynamicConfig.all` is the combined, yieldable-as-a-whole form (like `Config.all`);
pass a bag or an `all` into the other to convert between them.

Control lives on the swappable field itself — `field.set(value)` / `field.reset`
/ `field.changes` — so it's restricted to swappable fields at compile time
(`FixedField`s have none of them); `freeze` / `freezeField` hand out read-only
views. `extend` clones a config's fields and adds more. A swap writes a per-key
override into the store behind `DynamicConfig.layer` (a mutable `ConfigProvider`
over a `SubscriptionRef`, with env fallback), scoped per runtime. A per-runtime
allowlist guards the free `setByKey` path (the building block for remote/RPC
control) and validates the value through that key's `Config`.
