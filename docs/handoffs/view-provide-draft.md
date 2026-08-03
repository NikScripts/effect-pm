# Upward values — Requires / Provides / `Last.provide` (requirements)

**Status:** design — **not Eng’d** (written 2026-08-03 after downward bag+mount landed)  
**Branch:** `cursor/file-router-prototype-125f`  
**Package:** `last-ts` (`View`, `Last`; later `Layout` / `Page`)  
**Sibling (Eng’d):** [view-compose-draft.md](./view-compose-draft.md) — downward `R` (Context / Layer)  
**Consumers later:** [page-layout-design.md](./page-layout-design.md)

---

## Remember what we locked

We already have one direction Eng’d: **ancestor supplies services downward**.

| Direction | Debt | Discharge | Product shape today |
|-----------|------|-----------|---------------------|
| **Down** | `R` — Effect Context / Tag skins | Layer + `View.mount` | `Unresolved` until mount; bag `gen`/`succeed` merges child `R` |
| **Up** (this doc) | **Requires** — typed **values** an ancestor needs | Closed compose proves **Provides ⊆ Requires** | **Not Eng’d** — `Last.ts` is only `kindOf` today |

Same rule as downward: **type proof lives on View values + bag compose**, not on JSX trees. Stock TS still types `<… />` as black-box `JSX.Element`.

---

## Intent

1. A View (later Layout) declares **Requires** — keys it needs from descendants (or a seed bag).
2. Some **descendant View** (or optional seed) **Provides** those keys as **values**, not DOM nodes.
3. Writer API: `yield* Last.provide({ title: "Hello" })` — **last write wins**.
4. Reader API: `yield* Last.context` (Effect) + `Last.getContext` (sync peek), mirror annotations / `getAnnotations`.
5. Missing keys when the composition is **closed** ⇒ **type error**.
6. **Page / module root need not be the provider** — any nested View in the bag graph may provide.
7. **Eng Views first (V0)**; Layout/Page file-router reuse the same bag (see page-layout).

**Not goals (V0):** JSX child-type proofs; builtin Page `title`/`description`; Hyperlink `Views.Page` size chrome; pretending JSX bubbles Provides.

---

## Vocabulary (do not conflate)

| Term | Meaning |
|------|---------|
| **Requires** | Ancestor value-debt (object type: `{ readonly title: string }`). |
| **Provides** | Keys this View (and bag-merged children) have contributed via `Last.provide` / seed. |
| **`Last.provide`** | Upward **value** bag write. **Not** `Tag.provide` / `View.provide` (those build Layers for downward `R`). |
| **`View.mount`** | Downward only — Layer + RuntimeProvider for open `R`. Does **not** clear Requires. |
| **Close / fulfill (up)** | Compose (or layout/page close) that proves Provides cover Requires. Name open — see checklist. |
| **Requirement** | Older Prototype / Layout word for Requires — keep synonym until rename pass. |

English “provides a Layer” in mount docs ≠ type-param **Provides**. Prefer “supplies `R`” / “discharges `R`” in downward prose.

---

## Destination sketch (aligned with bag compose)

```tsx
/** @jsxImportSource last-ts */
import * as View from "last-ts/View"
import * as Last from "last-ts/Last"

// Ancestor declares value-debt (shape TBD — Prototype vs dedicated Requires param)
const Shell = View.Prototype<
  { readonly children?: React.ReactNode },
  { readonly title: string } // Requires
>()()

const TitleBlock = View.gen(function* () {
  yield* Last.provide({ title: "Hello" })
  return () => <h1>Hello</h1>
})
// TitleBlock: carries Provides = { title: string }; R as today

const Mid = View.gen(function* () {
  const { title } = yield* Last.context
  return () => <span>{title}</span>
})

// Bag compose — same product shape as downward; also merges Provides upward
const Body = View.succeed({ TitleBlock, Mid }, ({ TitleBlock, Mid }) => () => (
  <>
    <TitleBlock />
    <Mid />
  </>
))
// Body.Provides includes TitleBlock's title; Mid may read at runtime

// Close against Shell's Requires (API name TBD)
const PageBody = View.fulfill(Shell, Body) // or bag + close helper
// type error if Body.Provides does not cover Shell.Requires
```

Layout/Page later:

```ts
const Book = Layout.make<{ readonly title: string }>()(
  "app/layout/book",
  ({ Outlet, values }) => (
    <>
      <title>{values.title}</title>
      <Outlet />
    </>
  ),
)

export default Page.static(Book, ChapterTree)
// ChapterTree (or nested Views) must Provide Book's Requires; seed optional
```

---

## Rules

| Piece | Behavior |
|-------|----------|
| Values, not nodes | `Last.provide({ title })` — not a typed `<Title>` element |
| Last write wins | Later `provide` overrides earlier for the same key |
| Deep = View bag depth | Proof on exported Views + bag `gen`/`succeed`, not under random JSX |
| Provider anywhere | Closed composition’s merged Provides must cover Requires |
| Read in between | `Last.context` / `Last.getContext` see ambient bag (runtime) |
| Types vs runtime | Types on View exports; runtime bag ambient (Context / fiber ref / React context — impl open) |
| Orthogonal to `R` | A View can be `Unresolved` **and** carry Provides; mount clears `R`, not Requires |
| No builtins | Apps invent keys (`title`, `ogImage`, `crumb`, …) via Requires |

---

## Type params (sketch — Eng may refine)

Downward Eng’d roughly: `View<P, R>` → `Component` | `Unresolved`.

Upward needs a third axis (name bikeshed OK):

```ts
// Illustrative — not shipped
type View<P, R, Requires = {}, Provides = {}> = …
```

Bag merge (same callbacks as today):

- Child `R` → union into parent `R` (already Eng’d).
- Child `Provides` → merge into parent `Provides` (last-wins at type level = intersection / overwrite rules TBD).
- Parent/ancestor `Requires` stay until a **close** proves `Provides extends Requires` (remaining Requires → `{}` or error).

Seed bags (Page/Layout optional arg) count as Provides at the close site.

---

## API surface (V0 target)

| API | Role |
|-----|------|
| Declare Requires | `View.Prototype<Props, Requires>()` (existing debt idea) or explicit Requires on factories |
| `Last.provide(partial)` | Effect — merge bag; last wins; widen this View’s **Provides** |
| `Last.context` | Effect — read current bag (partial OK if typed) |
| `Last.getContext` | Sync peek (client), mirror `View.getAnnotations` |
| Bag `succeed` / `gen` | Merge child **Provides** (and `R`) while preserving names |
| Close helper | Prove Provides ⊆ Requires; name open (`fulfill` / `close` / layout `static`) |

**Not V0:** Layout chrome, Page stamp fields for meta, docs-site cutover.

---

## Relationship to downward Eng

```text
          Tag.provide / View.mount          Last.provide / fulfill
                     │                              │
                     ▼                              ▼
              services R ↓                    values Provides ↑
                     │                              │
              Unresolved → Component          Requires → {}
```

Both use **bag compose** so JSX inside the callback stays normal. Neither relies on JSX expression types.

---

## Acceptance (V0)

1. Deep child `Last.provide` satisfies ancestor Requires at **close** — type error if missing key/type.
2. Middle View `Last.context` can read a key provided by a sibling/descendant in the same closed bag (runtime + types as designed).
3. Second `Last.provide` for same key wins at runtime; types allow override.
4. Open-`R` Views still opaque (`Unresolved`); upward channel does not make them JSX-legal.
5. Zero Hyperlink product names inside `last-ts`.
6. Type tests + small Twoslash/demo (separate from or beside `view-typed-jsx`).

---

## Open decisions (owner before Eng)

1. **Close API name** — `View.fulfill` / `View.close` / only via Layout/`Page.static`? (Bag alone merges Provides; something must **check** against Requires.)
2. **Where Requires live on View** — keep Prototype second type param vs new axis next to `R`.
3. **Partial Provides typing** — exact object merge / `Simplify` / overwrite semantics for last-wins at the type level.
4. **Runtime substrate** — Effect Context vs React context vs both (SSR + client).
5. **Sync peek name** — `Last.getContext` vs `Last.getValues` (page-layout also said `getValues`).

Compose **name** for “merge Provides” is no longer `View.compose` vs nest: **reuse bag `gen`/`succeed`**. Only the **close/check** name is open.

---

## Explicitly rejected

| Idea | Why |
|------|-----|
| Typed JSX `<Title>` as proof | Erased; same lesson as downward `R` |
| `Tag.provide` for titles | Wrong direction — Layer skins, not value bag |
| Fake stamp witnesses | Owner rejected for downward; same here |
| Builtin Page meta fields | Layout/ancestor Requires own keys |
| Proving through arbitrary `<div>` trees | Proof on View bag only |

---

## Eng order

| Phase | Work |
|-------|------|
| **V0** | Requires + Provides on View; `Last.provide` / `context` / sync peek; bag merge Provides; close/check |
| **V1** | Type + runtime tests: deep provide, mid read, override |
| **L0+** | Layout/Page reuse bag — [page-layout-design.md](./page-layout-design.md) |

Do **not** start Layout/Page Eng until V0 acceptance is green (or owner overrides).

---

## Links

- Downward Eng: [view-compose-draft.md](./view-compose-draft.md)
- Guide (downward demo): [view-typed-jsx.md](../guides/view-typed-jsx.md)
- Page/Layout consumer design: [page-layout-design.md](./page-layout-design.md)
- Live downward demo: http://100.67.32.32:5190/docs/view-typed-jsx
