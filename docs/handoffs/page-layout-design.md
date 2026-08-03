# Page + Layout design plan

**Branch:** `cursor/file-router-prototype-125f`  
**Status:** design — **not locked**, not Eng’d  
**Package:** `last-ts` (`Page`, `Layout`, `Last`) — zero Hyperlink product names inside last-ts  
**Related:** [file-router-prototype](./file-router-prototype.md) · [view-page-naming](./view-page-naming.md) · [view-tag-prototype](./view-tag-prototype.md) · [last-ts-codesplit](../plans/last-ts-codesplit.md)

---

## Intent

Own file-router **pages** and **layouts** with:

1. Typed path + Static / Dynamic / Build (codegen stays honest).
2. **Upward values** (title, crumbs, actions, …) that **layouts require** and **pages provide** — missing ⇒ **type error**.
3. **`Last.provide`** — Effect channel; **last write wins** on a key (name = override semantics).
4. Minimalist public surface that stays **adaptable** (Prototype Requirement, Tag DI, plain helpers, `*.gen`).

**Not goals (v1):** inventing JSX child-type proofs for arbitrary `<div>` trees; baking SEO fields into Page core; colliding with Hyperlink dashboard `Views.Page` size chrome.

---

## Notes dump (conversation locks / leans)

### Vocabulary

| Term | Meaning |
|------|---------|
| **Page** | Route module body — path + render mode + component (file default export). |
| **Layout** | Chrome around an outlet; declares **Requirement** (values the page must provide). |
| **Provide (upward)** | Register a **value** into a bag (not a DOM title node). Last wins. |
| **Requirement** | R-style debt (same idea as View Prototype) — keys the layout needs. |
| **Stamp** | Runtime metadata on the default export (`stampOf`) for the file-router / `createPages` adapter. |
| **View** | Separate: DI components + `View.gen` / `fromEffect`. Pages *may* use Views inside; Page ≠ View. |
| **Views.Page** | Hyperlink dashboard **size** — never file-router Page. |

### Upward values (clarified)

- **Not** a nested `<Title>` element.
- A **value** via helper arg and/or `yield* Last.provide({ title: "Hello" })`.
- Prefer **override**: provide again later → last wins (name comes from that).
- Types track **Provided** vs open **Requirement**; gen/mint incomplete ⇒ type error.
- “Deep” = deep in **composition / gen**, not deep under random JSX.

### Metadata

- **`title` / `description` are not built into Page core.**
- They appear only if a **Layout Requirement** (or page-local bag) asks for them.
- Apps invent their own keys (`title`, `description`, `ogImage`, `crumb`, …).

### Relationship shapes considered

```ts
// A — Page-centric, layout as value arg
Page.static(MyLayout, component, values)

// B — Page-centric, layout as type arg (file-router ergonomics)
Page.static<MyLayout>(component, values?)

// C — Layout-centric (layout owns helpers)
MyLayout.static(component, values)
```

### Already shipped (context)

- CamelCase helpers: `Page.static` / `dynamic` / `build` / `layout` + `Render` + `stampOf` (meta currently optional on stamp — to be demoted off Page core).
- Path codegen: `last-ts/vite` `fileRouter`, `hyp file-router`.
- View: annotations bag (symbol), `View.annotations` Effect / `getAnnotations`, `Last.kindOf`, `View.fromEffect` / `gen` / `succeed`.
- `Page.Tag` / Layout class: **not Eng’d**.

### Open product follow-ons (out of this design doc’s Eng slice)

- Docs-site cutover → `createPages`.
- Dogfood `fileRouter` in `docs/site` waku config.
- Tip-sync work branch → `integration` (owner).

---

## Recommended API (minimalist, fully featured)

**Layout owns Requirement and the `static` / `dynamic` / `build` helpers.**  
Page is the body + path/render; Layout is the chrome + required upward bag.  
`Page.*` remains a thin alias that forwards to the layout (adaptable for people who think “Page first”).

### 1. Layout — Requirement + chrome

```ts
import * as Layout from "last-ts/Layout"
import * as Page from "last-ts/Page"
import * as Last from "last-ts/Last"
import * as View from "last-ts/View"

// Requirement = upward bag the page must fulfill (any keys)
const Book = Layout.Prototype<{
  readonly title: string
  readonly description?: string
}>()()

// Optional: mint a Layout Tag (DI / kind stamp) when you need identity
class BookLayout extends Book.Tag<BookLayout>()("app/layout/book") {}
```

Layout component shape (runtime):

```ts
type LayoutView<Req extends object> = (props: {
  readonly outlet: React.ReactNode
  readonly values: Req  // fulfilled bag (after last-wins merge)
}) => React.ReactElement | null
```

Provide chrome with `Layout.provide` / `View.provide` on a Layout Tag, or pass the function into Prototype — exact mint bikeshed later; **Requirement on Prototype is the lock.**

### 2. Page under a layout — Layout-centric (preferred)

```ts
// values discharge Book's Requirement (type error if title missing)
export default Book.static(AboutView, { title: "About" })

export default Book.dynamic(SearchView, { title: "Search" })

export default Book.build(ChapterView, {
  title: "Routing",
  paths: listChapterSlugs, // Effect — Build only
})
```

Path comes from **file-router convention** (module path → stamp.path) **or** an explicit overload:

```ts
Book.static("/about", AboutView, { title: "About" })  // explicit path when not file-routed
```

File-router default: path from disk; helpers don’t repeat the string unless override.

### 3. Page-centric aliases (same types)

```ts
Page.static(Book, AboutView, { title: "About" })
Page.static<typeof Book>(AboutView, { title: "About" })  // if we want type-param form
```

These are **pure forwarding** to `Book.static` — one implementation.

### 4. `Page.Tag` — DI identity when earned

```ts
class DocsChapter extends Page.Tag<DocsChapter, { chapter: string }>()(
  "app/page/docs-chapter",
  Book, // layout — Requirement flows in
  {
    path: "/docs/:chapter",
    render: Page.Render.Build(),
    paths: listChapterSlugs,
    // values optional here if filled in gen / provideLayer
  },
) {}

export default Page.build(DocsChapter) // reads stamp + layout from Tag
```

Tag does **not** own title builtins. Values via constructor bag, `Last.provide` in gen, or both (last wins).

### 5. `Page.gen` / `Last.provide` — Effect channel

```ts
export default Book.static(
  Page.gen(function* () {
    yield* Last.provide({ title: "Hello" })
    // later override — last wins
    yield* Last.provide({ title: "Hello — overridden" })
    const chapter = yield* loadChapter
    return (props: { chapter: string }) => <Article chapter={chapter} />
  }),
  // optional seed values (merged, then gen provides win on conflict)
  { description: "…" },
)
```

Semantics:

| Mechanism | Role |
|-----------|------|
| `values` arg on `static`/`dynamic`/`build` | Seed bag; must already satisfy Requirement **or** leave debt for gen |
| `yield* Last.provide(partial)` | Merge into bag; **last wins** per key; narrows type-level Provided |
| End of `Page.gen` | `Provided` must satisfy Layout Requirement (`{}` debt) |

`Last.provide` is cross-cutting (pages, later views). Storage: fiber/Context bag for the mint; stamp snapshot for the router.

### 6. What lives on the stamp (runtime)

```ts
type PageStamp = {
  readonly path: "/" | `/${string}`
  readonly render: Page.Render  // Static | Dynamic | Build
  readonly paths?: Effect.Effect<ReadonlyArray<string>>  // Build
  readonly layout: LayoutHandle   // for adapter / chrome
  readonly values: Readonly<Record<string, unknown>>  // fulfilled bag snapshot
}
```

No first-class `title` / `description` fields on Stamp — only whatever keys the layout required and the page provided.

### 7. Bare escape (no layout)

```ts
Page.static(AboutView)                    // path from file router; values = {}
Page.static("/about", AboutView)          // explicit path; no layout Requirement
```

No upward Requirement ⇒ nothing to prove. Layoutless pages are valid.

### 8. Nesting layouts

```ts
const App = Layout.Prototype<{ title: string }>()()
const Docs = App.Prototype<{ section: string }>()()  // additive Requirement

export default Docs.static(ChapterView, {
  title: "Routing",
  section: "Guide",
})
```

Outer layout wraps inner; values bag must satisfy **merged** Requirement. Runtime: nest outlets. Types: `Flat<AppReq & DocsReq>`.

---

## Type sketch (discharge)

```ts
type NextRequirement<Req, Provided> =
  Provided extends Req ? {} : Req

// Book.static(Comp, values): values must extend Requirement
// Page.gen against Book: running Provided accumulates via Last.provide
```

Mirror View’s `Requirement` / `IsFulfilled` / `AnnotationsOf` naming where it fits:

| View | Page / Layout / Last |
|------|----------------------|
| `View.Prototype` + annotations | `Layout.Prototype` + Requirement |
| `View.annotations` (Effect) | `Last.values` / `Last.provide` (Effect) |
| `View.getAnnotations` | `Last.getValues` (sync peek) |
| `View.gen` | `Page.gen` (returns page component; may `Last.provide`) |
| `Last.kindOf` | unchanged — factory brand |

---

## File router integration

1. Module default export = stamped component (`stampOf`).
2. Codegen path table unchanged (`paths.gen.ts`).
3. Loader: read stamp → render mode + paths + layout chrome + values bag.
4. `createPages` adapter (later) maps stamp → engine; apps never write Waku `getConfig`.
5. Disk `[param]` ↔ Route `:param` unchanged.

Dream file-router module:

```ts
import * as Page from "last-ts/Page"
// Book from app layouts
export default Book.build(
  Page.gen(function* () {
    yield* Last.provide({ title: "Routing" })
    return ChapterView
  }),
  { paths: listChapterSlugs },
)
```

---

## Adaptability matrix

| Need | API |
|------|-----|
| Quick file page | `Book.static(Comp, { title })` |
| Page-first spelling | `Page.static(Book, Comp, { title })` |
| Effect mint + overrides | `Page.gen` + `Last.provide` |
| DI identity | `Page.Tag` / `Layout.Tag` |
| No layout | `Page.static(Comp)` |
| Nested chrome | `Layout.Prototype` chain |
| Custom meta keys | whatever Requirement asks |
| Dashboard size Page | Hyperlink `Views.Page` only |

---

## Rejected / deferred

| Idea | Why |
|------|-----|
| JSX deeply nested `<Title>` as type proof | Erased; use values / `Last.provide` |
| Builtin Page `title`/`description` fields | Layout Requirement owns keys |
| `View.Page.Tag` for file routes | Collides with size chrome |
| `MyLayout` only as type param without value | Hard to get runtime chrome; prefer Layout value (`Book.static`) |
| Forbidding override | Last-wins is a feature |

---

## Eng phases (when locked)

| Phase | Work |
|-------|------|
| **L0** | `Layout` module: Prototype + Requirement discharge + `static`/`dynamic`/`build` on fulfilled layout |
| **L1** | `Last.provide` / `getValues` + bag merge (last wins); wire into `Page.gen` |
| **L2** | Demote builtin meta off `Page` stamp; migrate helpers to layout-centric |
| **L3** | `Page.Tag` mint with layout arg; `Page.build(Tag)` |
| **L4** | Nested layouts; file-router stamp reads layout+values |
| **L5** | Docs-site `createPages` cutover (product) |

Acceptance: type tests for missing `title`; runtime last-wins; existing codegen demo still green; no Hyperlink imports in last-ts.

---

## Decision checklist (owner — lock before Eng)

1. **Primary spelling:** Layout-centric `Book.static(Comp, values)` (**recommend**) vs Page-centric only.
2. **Path source:** file-router implicit vs always-explicit path arg (recommend: implicit in FS modules, explicit overload outside).
3. **`Page.gen` seed values:** allowed + last-wins with `Last.provide` (**recommend yes**).
4. **Layout Tag required?** or Prototype value enough for v1 (recommend: Prototype first; Tag optional).
5. **Sync name:** `Last.getValues` vs `Last.valuesSync` (match View: `getValues`).

---

## API cheat-sheet (recommended target)

```ts
import * as Layout from "last-ts/Layout"
import * as Page from "last-ts/Page"
import * as Last from "last-ts/Last"

const Book = Layout.Prototype<{ readonly title: string }>()()

export default Book.static(AboutView, { title: "About" })

export default Book.static(
  Page.gen(function* () {
    yield* Last.provide({ title: "Hello" })
    yield* Last.provide({ title: "Hello — wins" })
    return AboutView
  }),
)

// aliases
Page.static(Book, AboutView, { title: "About" })
```
