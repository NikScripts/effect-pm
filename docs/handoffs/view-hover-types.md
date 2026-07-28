# View hover types

**Open in the IDE (not GitHub):**  
[`examples/forms/view/hover-types.ts`](../../examples/forms/view/hover-types.ts)

Hover each exported `type` / `const` name to see full expansions. File is typechecked (root `tsconfig`).

## What to hover first

| Alias | Shows |
|-------|--------|
| `Effect_Config_InstanceService` | Effect Shape via instance `.Service` (no `typeof`) |
| `Shipped_PoolCard_Service` | Shipped chrome fn — **prefer this** |
| `Shipped_PoolCard_LongAnnotate` | Old long form `View.View<View.Type<typeof …>>` (same Shape) |
| `Shipped_DenseCard_Service` | Extra Prototype props on shipped Tag |
| `Shipped_DenseCard_Props` | Props peeled from `.Service` |
| `Poc_DenseCard_Service` | Flat POC `Card<Self, Props>()` for comparison |
| `hoverCheatSheet` | Bundle of the above |

## Takeaway

Shipped tags already mint `Context.ServiceClass` → `PoolCard["Service"]` works today. The long `View.Type<typeof>` path is optional.

Notes: [`view-tag-prototype.md`](./view-tag-prototype.md)
