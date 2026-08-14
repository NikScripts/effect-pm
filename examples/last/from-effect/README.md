# Catalog class → `effect` routes

**Run:** `pnpm run example:last-from-effect`

## Value

One `Site` catalog. A **`Catalog` service class** owns URL grammar (params, query,
which branches exist). Provide `layerAcme` or `layerGlobex` — the live route table
changes. App links use `Catalog.Urls<Spec>` so wrong locale / arity / branch is a
compile error.

| Piece | File |
|-------|------|
| `Catalog` class + `Site` + Layers | [`Catalog.ts`](./Catalog.ts) |
| Runner | [`main.ts`](./main.ts) |
| Type proof | `test/ui-from-effect-typed.test-d.ts` |

```ts
import { Catalog, Site, layerAcme, type AcmeUrls } from "./Catalog";

// fromEffect / groupsEffect read Catalog inside Site
declare const urls: AcmeUrls;
urls.content.variant("sku", "red", { query: { ref: "grid" } });
// urls.docs — compile error (Acme has no docs)
```
