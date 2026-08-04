# Page + Layout design plan

**Branch:** `cursor/file-router-prototype-125f`  
**Status:** design — **not locked**, not Eng’d (revised 2026-08-03)  
**Package:** `last-ts` (`Page`, `Layout`, `Last`, `View`) — zero Hyperlink product names inside last-ts  
**Spine SSOT:** [effect-app-router-plan.md](./effect-app-router-plan.md)  
**Provide sugar:** [view-provide-draft.md](./view-provide-draft.md) · **Down View:** [view-compose-draft.md](./view-compose-draft.md)  
**Related:** [file-router-prototype](./file-router-prototype.md) · [view-page-naming](./view-page-naming.md) · [view-tag-prototype](./view-tag-prototype.md) · [last-ts-codesplit](../plans/last-ts-codesplit.md)

---

## Intent

1. Typed path + Static / Dynamic / Build (codegen stays honest).
2. **Upward values** — a View/Layout **requires** keys; some **descendant View** (or seed bag) **provides** them. Missing when the tree is closed ⇒ **type error**. The page module itself need **not** be the provider.
3. **`Last.provide`** / **`Last.context`** — write/read the bag; **last write wins**.
4. **Eng order:** get require/provide working on **Views first**, then Layout/Page file-router.
5. Layout chrome via a **non-DI constructor** (outlet render-prop); optional **`Layout.Tag`** when DI is wanted.

**Not goals (v1):** JSX child-type proofs for arbitrary `<div>` trees; builtin Page `title`/`description`; colliding with Hyperlink `Views.Page` size chrome.

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

- **Not** a nested `<Title>` element — a **value** via arg and/or `yield* Last.provide({ title: "Hello" })`.
- **Last write wins** (name `provide` = override semantics).
- **Page need not provide.** Any View in the composed tree may `Last.provide`; debt clears when the **closed composition** satisfies the ancestor’s Requirement.
- Values readable **anywhere in between** via **`Last.context`** (Effect) / sync peek TBD.
- “Deep” = deep in **View composition / gen** (each export is a View that carries Requires/Provides), not under random JSX.
- **Eng first on Views** (require + provide + context); Layout/Page reuse the same bag.

### Layout chrome constructor (non-DI vs Tag)

```ts
// Non-DI — constructor after key / factory; outlet name TBD (not "Slot"? prefer Outlet)
const Book = Layout.make<{ readonly title: string }>()(
  "app/layout/book",
  ({ Outlet, values }) => (
    <shell title={values.title}>
      <Outlet />
    </shell>
  ),
)

// Or Effect-built chrome
const BookFx = Layout.make<{ readonly title: string }>()(
  "app/layout/book",
  ({ Outlet }) => Page.fromEffect(myLayoutEffect(Outlet)), // or View.fromEffect
)

// DI when wanted — separate constructor
class BookLayout extends Layout.Tag<BookLayout, { readonly title: string }>()(
  "app/layout/book",
) {}
Layout.provide(BookLayout, ({ Outlet, values }) => …)
```

Outlet naming: **Outlet** (router-familiar) preferred over Slot; final name open.

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

## Phase 0 — Views first (require / provide / context)

**Full requirements:** [view-provide-draft.md](./view-provide-draft.md).

Before Page/Layout file-router polish, ship the upward bag on **View**, using the **same bag `gen`/`succeed` shape** as downward compose (not a separate `View.compose`):

```ts
import * as View from "last-ts/View"
import * as Last from "last-ts/Last"

const Shell = View.Prototype<{ readonly children: React.ReactNode }, { readonly title: string }>()()

const TitleBlock = View.gen(function* () {
  yield* Last.provide({ title: "Hello" })
  return () => <h1>…</h1>
})

const Body = View.succeed({ TitleBlock }, ({ TitleBlock }) => () => <TitleBlock />)
// close/check against Shell.Requires — API name open (see view-provide-draft)
```

| API | Role |
|-----|------|
| View / Layout **Requires** | Keys still owed |
| `Last.provide(partial)` | Merge bag; last wins; adds to **Provides** |
| `Last.context` | Effect — read current bag |
| `Last.getContext` | Sync peek (client), mirror `getAnnotations` |
| Bag `succeed` / `gen` | Merge child **Provides** (and downward `R`) |
| Close helper | Prove Provides ⊆ Requires (name open) |

**Invariant:** type proof on View bag / close — not DOM shape.

---

## Recommended API (minimalist, fully featured)

**Layout = class or `Layout.make` handle** carrying Requirement + chrome.  
**Page** = path + render + body View. Body (or nested Views) provide values — page module optional seed only.

### 1. Layout — Requirement + chrome

```ts
import * as Layout from "last-ts/Layout"
import * as Page from "last-ts/Page"
import * as Last from "last-ts/Last"
import * as View from "last-ts/View"

// Non-DI (default)
const Book = Layout.make<{ readonly title: string }>()(
  "app/layout/book",
  ({ Outlet, values }) => (
    <html>
      <head><title>{values.title}</title></head>
      <body><Outlet /></body>
    </html>
  ),
)

// DI variant
class BookLayout extends Layout.Tag<BookLayout, { readonly title: string }>()(
  "app/layout/book",
) {}
```

Chrome props (runtime):

```ts
type LayoutChrome<Req extends object> = (props: {
  readonly Outlet: React.ComponentType<object> // or children — name open
  readonly values: Req // fulfilled bag after last-wins (may fill late at runtime)
}) => React.ReactElement | null
```

### 2. Page under a layout — class as type + value

```ts
import { Book } from "../layouts/Book"

// Seed values optional — nested Views may Last.provide instead
export default Page.static(Book, AboutView, { title: "About" })
export default Page.static<Book>(AboutView) // if AboutView's Provides already cover Req

export default Page.build(Book, ChapterTree, {
  paths: listChapterSlugs, // Build only — not meta
})
```

Path from **file-router** (disk) or explicit overload `Page.static(Book, "/about", Comp, seed?)`.

**Type rule:** closed page tree’s **Provides** (seeds ∪ all nested View provides) must satisfy `Layout.RequirementOf<typeof Book>`. Provider need not be the page root.

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

### 5. `Last.provide` / `Last.context` — Effect channel

```ts
// Deep View
export const ChapterHeading = View.gen(function* () {
  yield* Last.provide({ title: "Routing" })
  return () => <h1>Routing</h1>
})

// Anywhere between require and provide
export const Crumb = View.gen(function* () {
  const { title } = yield* Last.context // or Last.context<Pick<Req, "title">>
  return () => <span>{title}</span>
})

// Override later — last wins
yield* Last.provide({ title: "Routing — edit" })
```

| Mechanism | Role |
|-----------|------|
| Seed arg on `Page.static(Book, Comp, seed?)` | Optional initial bag |
| `yield* Last.provide(partial)` | Merge; **last wins**; contributes **Provides** on that View export |
| `yield* Last.context` | Read bag (partial OK if types allow) |
| Closed compose against Layout/View Requirement | **Provides** must cover **Requires** |

Runtime bag is ambient (Context / fiber ref) so middle Views can read/write. Types travel on **View exports + compose**, not through JSX.

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
| **V0** | **Views first:** Requirement + Provides on View; `Last.provide` / `Last.context` (+ sync peek); compose/nest that carries types; last-wins |
| **V1** | Type tests: deep child provides for ancestor require; middle `Last.context` reads; override wins |
| **L0** | `Layout.make` (non-DI, Outlet chrome) + `Layout.Tag` (DI); same bag as Views |
| **L1** | `Page.static(Book, …)` / class type param; seed optional; closed-tree discharge |
| **L2** | Demote builtin meta off Page stamp; Build `paths` only |
| **L3** | Nested layouts; file-router stamp |
| **L4** | Docs-site `createPages` cutover (product) |

Acceptance (V0): deep provide satisfies parent require at compose; `Last.context` typed; last-wins runtime; no Hyperlink in last-ts.

---

## Decision checklist (owner — lock before Eng)

1. **Eng Views-first (V0)** before Layout/Page — **recommend yes**.
2. **Outlet name:** `Outlet` vs `children` render-prop — **recommend Outlet**.
3. **Non-DI `Layout.make` + optional `Layout.Tag`** — **recommend yes**.
4. **Close/check API name** for Provides⊆Requires (`View.fulfill` / `View.close` / Layout `static` only) — open. Bag merge = existing `gen`/`succeed` (see [view-provide-draft](./view-provide-draft.md)).
5. **`Last.context` Effect + `Last.getContext` sync** — **recommend** (mirror annotations / getAnnotations).
6. Path source for file-router — implicit from disk + explicit overload.

---

## API cheat-sheet (recommended target)

```ts
import * as Layout from "last-ts/Layout"
import * as Page from "last-ts/Page"
import * as View from "last-ts/View"
import * as Last from "last-ts/Last"

// --- V0: Views ---
const Shell = View.Prototype<
  { readonly children?: React.ReactNode },
  { readonly title: string }
>()()

const Deep = View.gen(function* () {
  yield* Last.provide({ title: "Hello" })
  return () => <span />
})

const Mid = View.gen(function* () {
  const bag = yield* Last.context
  return () => <span>{bag.title}</span>
})

// --- Layout / Page (after V0) ---
const Book = Layout.make<{ readonly title: string }>()(
  "app/layout/book",
  ({ Outlet, values }) => (
    <>
      <title>{values.title}</title>
      <Outlet />
    </>
  ),
)

export default Page.static(Book, ChapterTree) // Provides come from nested Views
```
