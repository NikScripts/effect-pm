# Effect-native app router — full plan

**Status:** design SSOT (blank-slate lean, 2026-08-03)  
**Branch:** `cursor/file-router-prototype-125f`  
**Package:** `last-ts` only — zero Hyperlink product names  
**Supersedes as spine:** ad-hoc bag-compose-as-architecture, Prototype-as-title-debt  
**Keeps:** [view-compose-draft](./view-compose-draft.md) (down `R`), [view-provide-draft](./view-provide-draft.md) (`Last.provide` sugar), [file-router-prototype](./file-router-prototype.md) (codegen), [page-layout-design](./page-layout-design.md) (detail dump)

---

## What we need out of it

| Need | Why |
|------|-----|
| Typed routes + params | Schema-closed URLs; no stringly `href` |
| Static / Dynamic / Build | Honest SSR/SSG; Build needs `paths: Effect` |
| Nested layout chrome | Outlet; values like `title` for `<head>` |
| Leaf fills ancestor values | Page (or deep View) supplies what layout `yield*`s |
| Type error if missing | Close/router won’t typecheck incomplete Document (etc.) |
| View DI still works | Tag / `View.gen` / `mount` for component services |
| File modules optional | Codegen from disk later; **types don’t depend on folders** |
| Composable building blocks | Small Effect-shaped modules; apps assemble Layers |
| No JSX-as-proof | Stock React JSX; proof on Effects / Layers / View values |
| No builtin meta keys | Apps invent `Document`, `Og`, … as Context services |

**Not needs (v1):** RSC semantics, Next middleware clone, dashboard size chrome, Hyperlink names in last-ts.

---

## Core idea (one sentence)

**Layout declares Context debt by `yield*`-ing services; Page (or a nested View) contributes Layers that satisfy that debt; Router merges Layers and runs the tree — same as any Effect app.**

“Upward values” are **not** a second physics. They are **Layer contribution from the leaf** toward services the ancestor already put in `R`.

---

## `Page.view` — what it is (and is not)

### Where does the Document *requirement* get added?

**On the Layout (or any ancestor Effect that `yield* Document`).**

```ts
class Document extends Context.Service<
  Document,
  { readonly title: string }
>()("app/Document") {}

const Book = Layout.make(
  Effect.gen(function* () {
    const doc = yield* Document          // ← REQUIREMENT enters R here
    const Outlet = yield* Layout.Outlet
    return () => (
      <html>
        <head><title>{doc.title}</title></head>
        <body><Outlet /></body>
      </html>
    )
  }),
)
// Book: needs Layer<Document | Outlet>
```

Nothing about `Page.view` adds the requirement. **Consumers create debt.** That’s normal Effect.

### Is `Page.view` the upward system?

**It’s sugar for the page Effect’s return value** — UI + Layer contributions in one place:

```ts
const ChapterPage = Page.make(chapterRoute, Effect.gen(function* () {
  const { chapter } = yield* Page.params(chapterRoute)
  return Page.view({
    // PROVIDES Document — becomes Layer.succeed(Document, { title })
    document: { title: `${chapter} · Docs` },
    body: () => <article>{chapter}</article>,
  })
}))
```

Desugars conceptually to:

```ts
return {
  body: () => <article>{chapter}</article>,
  layer: Layer.succeed(Document, { title: `${chapter} · Docs` }),
}
```

| Piece | Role |
|-------|------|
| `yield* Document` in Layout | **Requires** (adds `Document` to `R`) |
| `Page.view({ document })` | **Provides** (page’s Layer contributes `Document`) |
| Router `Layer.provideMerge(page.layer)` | **Close** — Layout’s `R` discharged |
| Missing `document` / incomplete bag | **Type error** at page↔layout wiring |

Deep child alternative (same system, no `Page.view` field):

```ts
yield* Last.provide(Document, { title: "…" })  // ledger → Layer at close
```

`Page.view({ document })` is the **ergonomic page-level form**.  
`Last.provide` is the **deep View.gen form**.  
Both end as **`Layer` for a `Context.Service`**. Neither is Prototype annotation debt.

### Last-wins / partials / two titles

- Partials: `Last.provide(Document, { title })` then later more keys; merge before `toLayer`.
- Two titles: **two services** (`Document` vs `ModalMeta`), not one free `{ title }` bag.
- Override: later provide / later Layer merge wins (app policy).

---

## Building blocks (composable system)

Each block is a **module** with a single job. Apps compose; last-ts does not ship a framework god-object.

```
┌─────────────────────────────────────────────────────────────┐
│  Router          route table + match + run                  │
│    ├─ Route      Schema path + params                       │
│    ├─ Layout     chrome Effect (Outlet + Context R)         │
│    └─ Page       route + mode + Effect → body (+ layers)    │
├─────────────────────────────────────────────────────────────┤
│  View            React adapter: Tag / gen / mount / bag JSX │
│  Last            brands + Last.provide → Layer sugar        │
├─────────────────────────────────────────────────────────────┤
│  Context.Service app-owned bags (Document, …)               │
│  Layer           discharge R (standard Effect)              │
└─────────────────────────────────────────────────────────────┘
```

### 1. `Route`

- `Route.make("/docs/:chapter", ParamsSchema)`
- `Route.href(route, params)`, `Route.match`
- File codegen **emits** `Route` values; does not invent types alone

### 2. `Context.Service` bags (app-owned)

- `Document`, `Og`, `Crumb`, … — **not** builtins on Page
- Layout/chrome `yield*` what it needs
- Pages/Views contribute Layers

### 3. `Last`

- `kindOf` (existing)
- `Last.provide(Service, partial)` inside `View.gen` / page Effects
- `Last.toLayer(Service, view)` when Provides cover required keys  
- Optional later: `Last.context` / sync peek = `yield* Service` / `Context.get`

### 4. `View`

- **Down `R`:** Tag, `gen`, bag `succeed`/`gen`, `mount` — [view-compose-draft](./view-compose-draft.md)
- **Up Provides:** tokens from `Last.provide` — [view-provide-draft](./view-provide-draft.md)
- **Convenience (keep both):**
  - bag: `View.succeed({ A, B }, ({ A, B }) => …)` for **view values**
  - `yield* Effect.all({ A, B })` for **View.Tag / services**
- Not the router spine

### 5. `Layout`

```ts
Layout.make(effect)           // non-DI chrome; R from yield*
Layout.Outlet                 // Context.Service → page body component
Layout.Tag                    // optional DI identity when earned
```

Layout **requires** by yielding services. It does not list a separate “Requirement” type param unless we add sugar that mirrors `R`.

### 6. `Page`

```ts
Page.make(route, effect)           // effect → Page.Result
Page.view({ document?, body, layer? })
Page.params(route)                 // Effect of params
Page.static / .dynamic / .build    // render mode + Build paths
Page.Tag                           // optional file-module identity + stamp
stampOf                            // runtime adapter (createPages / Vite)
```

`Page.Result`:

```ts
type PageResult = {
  readonly body: (props: {}) => React.ReactElement | null
  readonly layer: Layer.Layer<any>  // Document | … contributions
}
```

`Page.view` builds that. Extra keys (`document`, `og`, …) are **registered contributors** (known Context services or a small registry), not magic React context.

### 7. `Router`

```ts
Router.make(layout, pages)
// merges: layout.layer ∪ page.layer ∪ outlet binding
// match URL → run page Effect → provide layers → render layout(body)
```

Close site for “layout got everything it `yield*`d.”

### 8. File adapter (later)

- Vite / `hyp file-router` codegen → typed path union + default exports
- `createPages` maps `stampOf` → engine
- Disk is UX; **Schema routes are SSOT**

---

## End-to-end picture

```ts
class Document extends Context.Service<
  Document,
  { readonly title: string }
>()("app/Document") {}

const chapter = Route.make("/docs/:chapter", ChapterParams)

const Book = Layout.make(
  Effect.gen(function* () {
    const doc = yield* Document
    const Outlet = yield* Layout.Outlet
    return () => (
      <>
        <title>{doc.title}</title>
        <Outlet />
      </>
    )
  }),
)

const ChapterPage = Page.make(
  chapter,
  Effect.gen(function* () {
    const { chapter } = yield* Page.params(chapter)
    // deep provide also OK:
    // yield* Last.provide(Document, { title: `${chapter} · Docs` })
    return Page.view({
      document: { title: `${chapter} · Docs` },
      body: () => <article>{chapter}</article>,
    })
  }),
  { render: Page.Render.Build(), paths: listChapterSlugs },
)

const App = Router.make(Book, [ChapterPage])
// type error if ChapterPage.layer doesn’t satisfy Book’s R (Document)
```

Wire:

```
URL → Router.match(chapter)
    → run ChapterPage.effect
    → Layer: Document ∪ Outlet(body)
    → run Book.effect under that Layer
    → React tree
```

---

## Relationship to spikes already Eng’d

| Spike | Role in this plan |
|-------|-------------------|
| View bag + `mount` | Local View composition + discharge component `R` |
| `Last.provide` / `toLayer` | Deep / View-level Document contribution |
| `Page.view({ document })` | Page-level contribution (same Layers) |
| Prototype `Requirement` | **Annotations only** — size/spec mint; **not** Document |
| Bag `succeed` vs `Effect.all` | Keep both; neither is the router |

---

## Eng phases

| Phase | Ship | Acceptance |
|-------|------|------------|
| **B0** | Lock this doc; demote bag-compose-as-spine in drafts | Owner ack |
| **B1** | `Page.Result` + `Page.view` contributor registry (`document` → `Document` service) | type tests: missing document fails layout wire |
| **B2** | `Layout.make` + `Layout.Outlet` + Router merge layout↔page Layers | runtime title in chrome from page |
| **B3** | `Last.provide` aligns as same Layer path as `Page.view` contributors | deep child provide satisfies layout |
| **B4** | `Page.static/dynamic/build` + stamp on Result | modes + Build paths |
| **B5** | `Route` Schema helpers + `Page.params` | typed href/params |
| **B6** | File codegen / `createPages` adapter | docs-site cutover path |
| **B7** | `Page.Tag` / `Layout.Tag` when identity earned | DI optional |

**Do not** Eng Layout chrome before B1–B2 agree on `Page.Result` / contributors.

---

## Explicit rejects

| Reject | Why |
|--------|-----|
| JSX child proofs for title | Erased |
| Prototype Requirement = title | Wrong bag / wrong close time |
| Builtin Page.title field | App owns Document (or not) |
| `Last.provided` sync ledger API | Write path is `yield* Last.provide` / `Page.view` |
| View.succeed bags as app architecture | Convenience only |
| Hyperlink names in last-ts | Product stays outside |

---

## Open decisions (owner)

1. **Contributor registry** — hardcode `document: Document` in last-ts vs app-passed `Page.contributors({ document: Document })`.
2. **Router API name** — `Router.make` vs extend existing `last-ts/Router`.
3. **Outlet** — Context.Service vs render-prop only on `Layout.make`.
4. **Partial Document** — require full bag in `Page.view` vs allow `Last.provide` partials only.
5. **Tip-sync** — when to fold into `integration`.

**Recommend:** app-passed contributors (no builtins); Outlet as Context.Service; full bag in `Page.view`, partials via `Last.provide`; reuse `last-ts/Router` if fit.

---

## Links

- Down View: [view-compose-draft.md](./view-compose-draft.md)
- Provide sugar: [view-provide-draft.md](./view-provide-draft.md)
- Page/Layout dump: [page-layout-design.md](./page-layout-design.md)
- File router: [file-router-prototype.md](./file-router-prototype.md)
