---
"last-ts": minor
---

**Typed JSX (`last-ts/jsx-runtime`):** View services `R` via `Element<R>` / `View<Props, R>` and `"jsxImportSource": "last-ts"`. Direct `jsx` / `jsxs` calls return `Element<R>`; JSX *syntax* uses a non-generic `JSX.Element` (TypeScript black box — omitting it types expressions as `any` and poisons `R`). Tree `R` also flows from typed `children?: Element<R>` and `View.stamp` / `View.ServicesOf`. Runtime still emits React elements; Radix / shadcn / plain components keep working. `View.gen` void → `() => null`.
