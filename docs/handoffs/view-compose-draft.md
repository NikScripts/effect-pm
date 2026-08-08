# DI Views — Service + Effect/Layer (no View masks)

**Status:** Eng on `cursor/file-router-prototype-125f`.  
**Not:** freestanding View values you call as JSX.  
**Not:** `View.succeed` / `View.gen` / `View.effect` — use `Layer` / `Effect`.  
**Opposite direction:** [view-provide-draft.md](./view-provide-draft.md) · spine [effect-app-router-plan.md](./effect-app-router-plan.md).

---

## Destination

```tsx
class Greeter extends View.make<Greeter, { readonly name: string }>()("…") {
  static layer = Layer.succeed(Greeter, ({ name }) => <span>{name}</span>)
}

class Hello extends View.make<Hello, { readonly who: string }>()("…") {
  static layer = Layer.effect(
    Hello,
    Effect.gen(function* () {
      const GreeterView = yield* Greeter
      return (props: { readonly who: string }) => (
        <GreeterView name={props.who} />
      )
    }),
  ).pipe(Layer.provide(Greeter.layer))
}

const Root = View.mount(Hello)
```

Compose deps on `static layer`. Call site is only `View.mount(RootService)`.

---

## Rules

| Piece | Behavior |
|-------|----------|
| `View.make` | Context slot; `yield*` → component |
| `Layer.succeed` / `Layer.effect` | Build the service Layer (Effect APIs) |
| `Effect.gen` | Yield Services, return render fn |
| `static layer` | Fulfilled Layer (`R = never`); camelCase; never `*Live` |
| `View.mount(Service)` | **Only** JSX edge — uses `Service.layer` |
| `View.succeed` / `View.gen` / `View.effect` / `View.provide` | **Removed** |

---

## Verification

- `pnpm exec tsc -p packages/last-ts`
- view / last-provide tests; `examples/ui/view-typed-jsx.tsx`
