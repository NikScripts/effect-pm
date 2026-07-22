---
"hyperlink-ts": major
---

**BREAKING — package and primitive rename: Effect Hyperlink (`hyperlink-ts`).**

The web made documents location-transparent; Effect Hyperlink does it for services.

### Package identity

- npm name: `@nikscripts/effect-pm` → **`hyperlink-ts`** (unscoped)
- Import subpaths: `hyperlink-ts/Hyperlink`, `hyperlink-ts/QueueResource`, …
- Wire / `Symbol.for` / Context ids that used `@nikscripts/effect-pm/…` now use `hyperlink-ts/…`

### Primitive

- Module `Resource` → **`Hyperlink`** (`src/Hyperlink.ts`, subpath `hyperlink-ts/Hyperlink`)
- Every `Resource.*` call site → `Hyperlink.*`
- Foundation symbols: `ResourceTag` → `HyperlinkTag`, `BuiltResource` → `BuiltHyperlink`, `ServedResources` → `ServedHyperlinks`, `DuplicateResourceKey` → `DuplicateHyperlinkKey`, etc.

```ts
import * as Hyperlink from "hyperlink-ts/Hyperlink";

class Emails extends Hyperlink.Tag<Emails>()("app/Emails", {
  send: Hyperlink.effect(Schema.Void),
}) {}
```

### Unchanged product names

`QueueResource`, `CustomQueueResource`, `RunResource`, `HttpApiResource`, and `ResourceConfigure` keep their names.

### Migrate

1. `pnpm add hyperlink-ts` (remove `@nikscripts/effect-pm`)
2. Replace imports: `@nikscripts/effect-pm` → `hyperlink-ts`, `/Resource` → `/Hyperlink`
3. Replace `import * as Resource` / `Resource.` with `Hyperlink`
4. Re-deploy clients and servers together — wire id prefixes changed

GitHub repository URL strings are unchanged until the repo is renamed.
