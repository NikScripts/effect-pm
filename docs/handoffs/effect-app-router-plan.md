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

## Requires / Provides

**Rejected:**
- `Page.view({ document, body })` — fake contributor sugar
- `return { body, layer }` — never pass a Layer through the page result
- `View.succeed({ A }, ({ A }) => () => …)` — bag compose (gone)

### Where does the Document *requirement* get added?

**On the Layout (or any ancestor that `yield* Document`).** Consumers create debt.

```ts
class Document extends Context.Service<Document, string>()("app/Document") {
  /** Layer constructor — apps compose these, pages don’t return them. */
  static title(title: string): Layer.Layer<Document> {
    return Layer.succeed(Document, title)
  }
}

const Book = Layout.make(
  Effect.gen(function* () {
    const title = yield* Document       // ← REQUIREMENT enters R here
    const Outlet = yield* Layout.Outlet
    return () => (
      <html>
        <head><title>{title}</title></head>
        <body><Outlet /></body>
      </html>
    )
  }),
)
```

### How does the page provide?

Page Effect returns **only the body**. Contribute Document via `Last.provide` (harvested to a Layer at close) or compose `Document.title(…)` at the Router/app Layer edge — **not** in the return value.

```ts
const ChapterPage = Page.make(
  chapterRoute,
  Effect.gen(function* () {
    const { chapter } = yield* Page.params(chapterRoute)
    yield* Last.provide(Document, `${chapter} · Docs`)
    return () => <article>{chapter}</article>   // body only
  }),
)

// static Layer ctor when the title is known at the edge:
Document.title("Docs")
```

| Piece | Role |
|-------|------|
| `yield* Document` in Layout | **Requires** |
| `Document.title(s)` | **Layer ctor** on the service class |
| `yield* Last.provide(Document, s)` | **Provide inside page/view** (→ Layer at close) |
| Router merges harvested Provides | **Close** |
| Page return | **body only** |

### Last-wins / two titles

- Two titles ⇒ two services (or one service, last `provide` wins).
- `Document.title` / `Last.provide` are the write paths — no `{ layer }` bag.

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
│  View            Service (+ `.layer`) / gen / mount — no bag compose │
│  Last            brands + Last.provide → harvested Layer          │
├─────────────────────────────────────────────────────────────┤
│  Context.Service app services + static Layer ctors (Document.title) │
│  Layer           discharge R (standard Effect)              │
└─────────────────────────────────────────────────────────────┘
```

### 1. `Route`

- `Route.make("/docs/:chapter", ParamsSchema)`
- `Route.href(route, params)`, `Route.match`
- File codegen **emits** `Route` values; does not invent types alone

### 2. `Context.Service` + static Layer constructors (app-owned)

```ts
class Document extends Context.Service<Document, string>()("app/Document") {
  static title(title: string): Layer.Layer<Document> {
    return Layer.succeed(Document, title)
  }
}
```

- Layout `yield*` what it needs
- Static methods build Layers; never stuff Layers into page return values

### 3. `Last`

- `kindOf` (existing)
- `Last.provide(Service, value)` inside page / `View.gen`
- `Last.toLayer(Service, view)` when Provides cover the service
- Optional later: sync peek = `Context.get`

### 4. `View`

- **Down `R`:** `View.Service` + class `static layer = This.provide(…)` (Effect v4 style; no `{ default }`), unary `gen` / `succeed`, `mount`
- **Compose services:** `yield* Effect.all({ Shell, Hello })` then JSX on resolved views
- **Open-`R` view values:** `View.mount(view, Service.layer)` — **no** bag `succeed`
- **Naming:** handle mint is `*.Service` (not `*.Tag`); baked config+layer factories are `*.define` (`Gate.define` / `WorkPool.define` / `Daemon.define`)
- **Up Provides:** `Last.provide` — [view-provide-draft](./view-provide-draft.md)

### 5. `Layout`

```ts
Layout.make(effect)           // non-DI chrome; R from yield*
Layout.Outlet                 // Context.Service → page body component
Layout.Service                // optional DI identity when earned
```

### 6. `Page`

```ts
Page.make(route, effect)           // effect → body component (Provides via Last.provide)
Page.params(route)
Page.static / .dynamic / .build
Page.Service / stampOf             // DI identity when earned (v4 naming)
```

Effect return = **body only** (`(props) => ReactElement | null` or equivalent View).

### 7. `Router`

```ts
Router.make(layout, pages)
// harvest Last.provide / Document.title layers; bind Outlet; run layout
```

### 8. File adapter (later)

- Vite / `hyp file-router` codegen → typed path union + default exports
- `createPages` maps `stampOf` → engine
- Disk is UX; **Schema routes are SSOT**

---

## End-to-end picture

```ts
class Document extends Context.Service<Document, string>()("app/Document") {
  static title(title: string): Layer.Layer<Document> {
    return Layer.succeed(Document, title)
  }
}

const chapter = Route.make("/docs/:chapter", ChapterParams)

const Book = Layout.make(
  Effect.gen(function* () {
    const title = yield* Document
    const Outlet = yield* Layout.Outlet
    return () => (
      <>
        <title>{title}</title>
        <Outlet />
      </>
    )
  }),
)

const ChapterPage = Page.make(
  chapter,
  Effect.gen(function* () {
    const { chapter } = yield* Page.params(chapter)
    yield* Last.provide(Document, `${chapter} · Docs`)
    return () => <article>{chapter}</article>
  }),
  { render: Page.Render.Build(), paths: listChapterSlugs },
)

const App = Router.make(Book, [ChapterPage])
// type error if page Provides don’t cover Document
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
| View unary `gen` / `mount` | Component `R`; Tags via `Effect.all` |
| `Last.provide` / `toLayer` | Page/view Provides → Layer at close |
| `Document.title` | Static Layer ctor on the service |
| Prototype `Requirement` | **Annotations only** — not Document |
| Bag `View.succeed({…}, …)` | **Removed** |

---

## Eng phases

| Phase | Ship | Acceptance |
|-------|------|------------|
| **B0** | Lock this doc; kill bag compose + `{ body, layer }` | Owner ack |
| **B1** | Page body-only + `Last.provide` / `Document.title` | type tests: missing Document fails wire |
| **B2** | `Layout.make` + `Layout.Outlet` + Router harvest Provides | runtime title from page provide |
| **B3** | Align `Last.toLayer` with Router close | deep child provide satisfies layout |
| **B4** | `Page.static/dynamic/build` + stamp on Result | modes + Build paths |
| **B5** | `Route` Schema helpers + `Page.params` | typed href/params |
| **B6** | File codegen / `createPages` adapter | docs-site cutover path |
| **B7** | `Page.Service` / `Layout.Tag` when identity earned | DI optional |

**Do not** Eng Layout chrome before B1–B2 agree on body-only Page + Provide harvest.

---

## Explicit rejects

| Reject | Why |
|--------|-----|
| JSX child proofs for title | Erased |
| Prototype Requirement = title | Wrong bag / wrong close time |
| Builtin Page.title field | App owns Document (or not) |
| `Page.view` / `{ body, layer }` | Bad — body only; Layers via service statics / `Last.provide` |
| `View.succeed({ A }, ({ A }) => …)` | Removed — Tags + `Effect.all`, or `mount` then JSX |
| `Last.provided` | Write path is `yield* Last.provide` |
| Hyperlink names in last-ts | Product stays outside |

---

## Open decisions (owner)

1. **Router API name** — `Router.make` vs extend existing `last-ts/Router`.
2. **Outlet** — Context.Service vs render-prop only on `Layout.make`.
3. **Page `layer` optional?** — omit when page Provides only via nested `Last.provide` views the router harvests.
4. **Tip-sync** — when to fold into `integration`.

**Recommend:** Outlet as Context.Service; page may omit `layer` if child Provides cover layout `R`; reuse `last-ts/Router` if fit.

---

## Links

- Down View: [view-compose-draft.md](./view-compose-draft.md)
- Provide sugar: [view-provide-draft.md](./view-provide-draft.md)
- Page/Layout dump: [page-layout-design.md](./page-layout-design.md)
- File router: [file-router-prototype.md](./file-router-prototype.md)
