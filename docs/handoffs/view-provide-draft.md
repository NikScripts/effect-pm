# Upward values — Context.Service + `Last.provide` (spike)

**Status:** spike Eng’d on `cursor/file-router-prototype-125f` (typed ledger → Layer)  
**Package:** `last-ts` (`Last`)  
**Sibling (Eng’d):** [view-compose-draft.md](./view-compose-draft.md) — downward `R`  
**Later:** Layout / Page reuse the same Context bags

---

## JSX import

**Not required** for this channel. Proof is Context `R` + `Last.toLayer` completeness, then
`View.mount`. Stock `react` `jsxImportSource` is fine. `last-ts` jsx runtime stays optional
(leftover from the failed JSX-`R` experiment).

---

## Lean (locked for spike)

Value bags are **normal `Context.Service`s** — not View.Tag, not Prototype annotations.

| Piece | Role |
|-------|------|
| `class Foo extends Context.Service<Foo, Bag>()("…")` | Identity + full bag type |
| `Last.provided(Foo, partial)` / `Last.provide` | Typed partial; last-wins via `Last.merge` |
| `yield* Foo` | Read (classic Effect) |
| `Last.toLayer(…)` | **Only** if required keys covered → `Layer<Foo>` |
| `View.mount(view, layer)` | Discharge `R` as today |

Two services ⇒ two titles never collide (`ShellMeta.title` ≠ `ModalMeta.title`).

---

## Verified

```ts
class ShellMeta extends Context.Service<
  ShellMeta,
  { readonly title: string }
>()("app/shell-meta") {}

const Shell = View.gen(function* () {
  const meta = yield* ShellMeta
  return () => <h1>{meta.title}</h1>
})

const App = View.mount(
  Shell,
  Last.toLayer(Last.provided(ShellMeta, { title: "uDumb" })),
)
// incomplete bag → toLayer is not Layer<ShellMeta> (type error at mount)
```

Tests: `test/last-provide.test-d.ts`, `test/last-provide.test.ts`.

---

## Not yet

| Gap | Notes |
|-----|--------|
| Auto-thread Provides onto `View` from `yield* Last.provide` | Ledger is still an explicit value; gen does not infer Provides |
| Ambient / deep tree collection | No FiberRef ledger yet — caller merges `Provided` then `toLayer` |
| Layout / Page | After View wiring feels good |
| Prototype annotation Requirement | Separate channel — do not merge into this |

---

## Annotation Requirement vs this

| | Prototype Requirement | Context.Service Provides |
|--|----------------------|---------------------------|
| Subject | Tag mint metadata | Runtime value bag in Context |
| Discharge | `.Prototype()({ size })` | `Last.toLayer` → Layer |
| API | `View.annotations` | `yield* Service` / `Last.provided` |

Same *pattern* (typed debt → provide → close). Different bags. Do not overload Prototype’s second type param for titles.

---

## Links

- Downward Eng: [view-compose-draft.md](./view-compose-draft.md)
- Page/Layout (later): [page-layout-design.md](./page-layout-design.md)
