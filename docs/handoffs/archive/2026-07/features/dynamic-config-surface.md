# DynamicConfig — API surface (shipped)

Hot-swappable config on top of Effect `Config`. Implemented in `src/DynamicConfig.ts`,
exported from the package root as the `DynamicConfig` namespace.

## Model

- A config is a **plain bag of `ConfigField` wrappers** (`DynamicConfig.make(...)`) —
  **not** a service tag, so any field name is allowed (even `key`).
- A `ConfigField` is **yieldable**: `yield* cfg.apiKey` reads its underlying
  `Config` through the ambient `ConfigProvider`, exactly like a plain `Config`
  (`R = never`). The config owns no values — only *where to find them* (env keys).
- **Control is methods on the field** (`field.set(v)` / `.reset` / `.changes`), swappable fields only; `setByKey` is the free string-keyed path.
- A swap writes a per-key override into the store behind `DynamicConfig.layer`
  (a mutable `ConfigProvider` over a `SubscriptionRef`, env fallback). Every
  reader — wrapper or raw `Config` — sees it. The store is scoped per runtime.

## Define

```ts
const cfg = DynamicConfig.make({
  baseUrl: Config.string("BASE_URL").pipe(Config.withDefault("https://x")),
  apiKey: DynamicConfig.swappable(Config.redacted("API_KEY")),   // SwappableField
  retries: DynamicConfig.swappable(Config.int("RETRIES").pipe(Config.withDefault(3))),
});
// cfg.baseUrl : FixedField<string>
// cfg.apiKey  : SwappableField<Redacted<string>>
```

**Single field, no `make`.** `swappable` is also the single-field constructor —
it returns a usable `SwappableField` on its own (yieldable, with `.set` /
`.reset` / `.changes`). Use it directly when you just need one hot-swappable
value; `make` is only for grouping several fields into a bag.

```ts
const apiKey = DynamicConfig.swappable(Config.redacted("API_KEY"));
const k = yield* apiKey;                  // read
yield* apiKey.set("new");          // swap
```

`swappable` is unary, so it's **pipeable** as-is (no `dual` needed):

```ts
const apiKey = Config.redacted("API_KEY").pipe(
  Config.withDefault(Redacted.make("")),
  DynamicConfig.swappable,   // joins the allowlist here, too
);
```

`make` accepts a plain `Config` (→ read-only field) or an already-built field
from `swappable` / another bag.

## Read (native `Config`)

```ts
const url = yield* cfg.baseUrl;   // string
const key = yield* cfg.apiKey;    // Redacted<string>, latest value
```

## Control (methods on the field, swappable-only)

Control lives on the swappable field itself — `.set` / `.reset` / `.changes`.
`FixedField`s don't have them, so control is restricted at compile time.

```ts
yield* cfg.apiKey.set("rotated");   // .set is only on SwappableField
yield* cfg.apiKey.reset;            // revert to env/default (a property, not a call)
cfg.apiKey.changes;                 // Stream of this field's changed keys

// cfg.baseUrl.set(...)              // compile error — FixedField has no .set

// string-keyed path (RPC handlers): allowlist-guarded + validated (stays a free fn)
yield* DynamicConfig.setByKey("API_KEY", "rotated"); // ConfigKeyNotSwappable if not declared
```

## All — combined, yieldable as a whole (like `Config.all`)

`make` gives per-field accessors; `all` gives one yieldable value. Pass either
into the other to convert — the configs are identical, only the result shape
differs.

```ts
const whole = yield* DynamicConfig.all(cfg);  // { baseUrl, apiKey, retries } — one read
// whole.apiKey  (no per-field .set — use `make` for control)

DynamicConfig.all(makeBag);   // make → all
DynamicConfig.make(allConfig); // all → make (back to per-field accessors)
```

`all` reads every field at once (`Effect.all`), so it's all-or-nothing — it fails
if any field fails. Per-field reads via `make` are independent.

## Extend (clone + add — no dependency)

```ts
const child = DynamicConfig.extend(cfg, {
  batchSize: Config.int("BATCH").pipe(Config.withDefault(100)),
});
// child.apiKey is the inherited SwappableField (same env slot); child.batchSize is own
```

## Freeze (capability — read-only views, touches no store state)

```ts
const safe = DynamicConfig.freeze(cfg);              // every field → FixedField
const partial = DynamicConfig.freezeField(cfg, "apiKey"); // only apiKey frozen
// set won't compile against frozen fields; reads still reflect the live value
```

## Wire

```ts
program.pipe(Effect.provide(DynamicConfig.layer)); // provide once, high in the runtime
```

`DynamicConfig.layer` provides the `ConfigProvider` (override store first, env
fallback) and `DynamicConfigStore`. Provide it at/above any scope that reads or
swaps; scoping (`Effect.scoped`) and `fork` inherit it. Separate runtimes/processes
have their own store — swap those via their own `setByKey` (e.g. an RPC procedure).

## Safeguards

- **Type-level:** `set` / `reset` accept `SwappableField` only; `freeze` strips that.
- **Per-runtime allowlist:** `make` records each swappable field's env key → its
  `Config` in a registry; `layer` snapshots it into the store. `setByKey` (the
  untyped/remote path) rejects keys not in the allowlist and validates the value.
- **Permanent immutability:** don't mark a field swappable.
- **Redaction:** `Redacted` fields stay redacted in reads and `changes`.

## Public exports

`DynamicConfig` (namespace: `make`, `all`, `extend`, `swappable`, `freeze`,
`freezeField`, `setByKey`, `layer`, `Store`, `isConfigField`). Per-field control
(`.set` / `.reset` / `.changes`) lives on the `SwappableField` itself. Also
exports `DynamicConfigStore`, `ConfigKeyNotSwappable`, and types `ConfigField`,
`SwappableField`, `FixedField`, `ConfigBag`, `AllConfig`.

## Known limitation

Env-key extraction probes the `Config` at `make` time. Robust for single-key
fields (the hot-swap use case); composite/multi-key configs register every key
they touch, which is coarse — prefer per-value swappable fields.

## Deferred (optional)

Typed key-literal manifest: capture env keys as literals so `setByKey` is
compile-time key-checked and a control contract can be derived from the type.
Not implemented — `Config` erases its key from the type, so it needs the key
declared as a literal (small duplication). See the requirements doc.
