{#deprecated title="Deprecated methods" status="stable" done="api" appliesTo=node}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/deprecated>.
<!-- docs-site-link:end -->
# Deprecated methods — retire a verb, keep the wire

`Hyperlink.deprecated` is the **invert of `local`**: the method stays on the RPC /
`contractHash` surface (impl still required) so old clients can dial during skew, but it
is **omitted** from `yield* Tag` / `ServiceOf` so new app code cannot call it.

Prefer the pipe form:

```ts
import * as Hyperlink from "hyperlink-ts/Hyperlink"
import { Schema } from "effect"

class Files extends Hyperlink.Tag<Files>()("app/Files", {
  move: Hyperlink.effectFn({
    payload: Schema.Struct({ from: Schema.String, to: Schema.String }),
    success: Schema.Void,
  }),
  rename: Hyperlink.effectFn({
    payload: Schema.Struct({ from: Schema.String, to: Schema.String }),
    success: Schema.Void,
  }).pipe(Hyperlink.deprecated),
}) {}

Hyperlink.serve(Files, {
  move: (p) => Effect.void,
  rename: (p) => Effect.void, // still required — old clients dial this
})

const files = yield* Files
files.move   // ✅
files.rename // ❌ DeprecatedOmitted — not callable; runtime Handle omits the key
```

Data-first dual is also valid: `Hyperlink.deprecated(method)`.

On `ServiceOf`, a deprecated leaf types as `DeprecatedOmitted` (not key-deleted) so
generic Tag factories (Gate/Daemon) keep unrelated members; **runtime** local/client Handles
omit the property entirely.



## Lifecycle

1. Method is normal wire + Handle.  
2. `.pipe(Hyperlink.deprecated)` — Handle hides; wire + `contractHash` **unchanged**.  
3. After the fleet is past skew: **delete** the leaf → `contractHash` changes → remaining
   old clients fail loud (`ContractMismatch`).

## vs Versioned

| Need | Tool |
|------|------|
| Method stays; **payload tip** moves | [`Versioned`](./versioned.md) |
| **Verb** leaves the product API | `Hyperlink.deprecated` |
| Both during skew | deprecated method whose payload is still a Versioned leaf |

## Not this module

- Whole Spec drift → `contractHash` / F4  
- Lookup / Launcher update impact → see
  [`versioned-schema-decisions.md`](../handoffs/versioned-schema-decisions.md)  
- CLI/TUI hide-vs-mark — open follow-up

Design lock: [`versioned-schema-decisions.md`](../handoffs/versioned-schema-decisions.md#planned--hyperlinkdeprecated-method-retirement-eng-after-versioned).
