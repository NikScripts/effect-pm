# Last.context + View UI kits (owner lock)

**Status:** LOCK — **track 1 + track 2 + T2e/T2f Eng’d** (tip-synced)  

**Branch:** `cursor/agent-k-page-route-6d0e` (same tip as `integration` after sync)  
**Package:** `last-ts`  
**Related:** [`page-layout-lock.md`](./page-layout-lock.md) · [`last-provider-lock.md`](./last-provider-lock.md) · [`router-httpapi-lock.md`](./router-httpapi-lock.md)

## One-sentence lock

**Component DI is `View`. Group kits with `Last.context` / `Last.provider` / `Last.use`. Build custom links with `Last.link` (wrap a component or a narrowed `Link`). Prefer named link components over raw `Link`.**

## Build order (two tracks)

| # | Track | Status |
|---|--------|--------|
| **1** | `Last.context` + `Last.provider(Context)` + `Last.use` + **`Last.link`** + base `Link` `to`/`out` | **Eng’d + tip-synced** |
| **2** | Adapt context tools to the **router/builder** (provide per catalog / group / route; `Last.use` active scope) | **Eng’d** — `.context` + `Last.provideContext` + Outlet mounts + `Last.use(App, …)` |

---

## Hard rules

| Rule | Detail |
|------|--------|
| Component ⇒ **View** | If the service value is a React component, it is a **View** — not `Context.Service`. Same DI job; use `View.make`. |
| `Context.Service` | Only for **non-component** values (e.g. copy / config bags). |
| Leaf Views own DOM | Pure HTML (`header`, `a`, `aside`, …) lives in the leaf View default (or provided impl). |
| Composition Views | **Zero** DOM tags — only compose other Views / `Last.use` results / content services. |
| No `href="/…"` in kits | In-app / external via **`Link`** / **`Last.link`** (`to` / `out`). |
| Prefer `Last.link` | Avoid raw `Link` except when a custom link component makes no sense. |
| No `.layer` API on context | No `Site.layer`, no `bag.layer(…)`, no `static layer` on classes. Plain `Layer.succeed` / `Layer.mergeAll` at the edge when binding impls. |
| No “Chrome” | Banned name (see layout lock). |
| `import * as` | All last-ts and local modules: `import * as NavBar from "./NavBar"`, then `NavBar.NavBarContext`. |
| API shape | `Last.context` / `Last.provider(Context)` / `Last.use(Context)` / `Last.link` — not `Site.use()` methods. |

---

## Core API

```ts
import * as Last from "last-ts/Last"

// 1) Create (class or const)
export class NavBarContext extends Last.context({
  Root,
  Brand,
  Nav,
  Item,
  View: NavBar,
}) {}

export class Site extends Last.context({
  NavBar: NavBar.NavBarContext,
  Sidebar: Sidebar.SidebarContext,
  Footer: Footer.FooterContext,
  Frame: Frame.FrameContext,
  SiteCopy: SiteCopy.SiteCopy,
}) {}

// 2) Provider — context, not an ad-hoc Layer dump
export const Provider = Last.provider(Site.Site)

// 3) Use
const { NavBar, Frame } = Last.use(Site.Site)
const { Root, Brand, View } = Last.use(NavBar.NavBarContext)
// or from the bag: NavBar.View / NavBar.Root
```

### Nesting

- Contexts nest: `Site` holds `NavBarContext`, etc.
- **One edge provider:** `Last.provider(Site)` installs the full tree. Do not hand-nest Provider components in `Tree`.
- `Last.use(NavBarContext)` works under that provider; `Last.use(Site)` returns the nested bag.
- Partial mount (tests): `Last.provider(NavBarContext)` alone is OK.

### Types

- `Last.ServicesOf<typeof Site>` — Layer / runtime debt (union of required services).
- No `BagOf`. Prefer inferring `Last.use(Site)`’s return type (or a `Type` stamp if needed).

---

## Module layout (co-locate kit)

Each region is **one module**: leaf Views + composition View + `*Context`.

```ts
// ui/NavBar.tsx
import type * as React from "react"
import * as Last from "last-ts/Last"
import * as View from "last-ts/View"
import { Link } from "../lib/Catalog" // Router.link(Catalog) — same module as router
import * as SiteCopy from "../lib/SiteCopy"

// --- Leaf Views (DOM here) ---

export class Root extends View.make<Root, {
  readonly children?: React.ReactNode
}>()(
  "last-ts/site/NavBar/Root",
  (props) => (
    <header className="navbar">
      <div className="navbar-inner">{props.children}</div>
    </header>
  ),
) {}

// `to` / `out` are props from the composition View — never hardcode href="/"
export class Brand extends View.make<Brand, {
  readonly to: string
  readonly children?: React.ReactNode
}>()(
  "last-ts/site/NavBar/Brand",
  (props) => (
    <Link.Link className="navbar-brand" to={props.to}>
      {props.children}
    </Link.Link>
  ),
) {}

export class Nav extends View.make<Nav, {
  readonly children?: React.ReactNode
}>()(
  "last-ts/site/NavBar/Nav",
  (props) => (
    <nav className="navbar-links" aria-label="Primary">
      {props.children}
    </nav>
  ),
) {}

/** Link leaf — pass `to` xor `out`. */
export class Item extends View.make<Item, {
  readonly to?: string
  readonly out?: string
  readonly children?: React.ReactNode
}>()(
  "last-ts/site/NavBar/Item",
  (props) => (
    <Link.Link to={props.to} out={props.out}>
      {props.children}
    </Link.Link>
  ),
) {}

// --- Composition View (zero DOM tags) ---

export class NavBar extends View.make<NavBar>()(
  "last-ts/site/NavBar",
  () => {
    const { Root, Brand, Nav, Item } = Last.use(NavBarContext)
    const copy = Last.use(SiteCopy.SiteCopy)
    const urls = /* urlBuilder / router urls */

    return (
      <Root>
        <Brand to={urls.index()}>{copy.brand}</Brand>
        <Nav>
          {copy.nav.map((link) =>
            link.out !== undefined ? (
              <Item key={link.out} out={link.out}>
                {link.label}
              </Item>
            ) : (
              <Item key={link.to} to={link.to}>
                {link.label}
              </Item>
            ),
          )}
        </Nav>
      </Root>
    )
  },
) {}

// --- Context (views grouped with their kit) ---

export class NavBarContext extends Last.context({
  Root,
  Brand,
  Nav,
  Item,
  View: NavBar,
}) {}
```

```ts
// lib/Site.ts
export class Site extends Last.context({
  NavBar: NavBar.NavBarContext,
  Sidebar: Sidebar.SidebarContext,
  Footer: Footer.FooterContext,
  Frame: Frame.FrameContext,
  SiteCopy: SiteCopy.SiteCopy,
}) {}
```

Views are **not** flattened onto `Site` (`NavBarView` sibling is forbidden). They live on the region context as `View`.

```tsx
// lib/Tree.tsx — composition only
const { NavBar, Sidebar, Footer, Frame } = Last.use(Site.Site)

return (
  <>
    <NavBar.View />
    <Frame.Root>
      <Sidebar.View />
      <Frame.Main>
        <Layout.Outlet />
      </Frame.Main>
    </Frame.Root>
    <Footer.View />
  </>
)
```

```ts
// lib/Provider.tsx
export const Provider = Last.provider(Site.Site)
```

```ts
// lib/Body.tsx — Layout places the component only
export class Body extends Layout.make()(
  "last-ts/site/Body",
  Effect.succeed(<Tree.Tree />),
) {}
```

---

## Defaults

- Composition Views (e.g. `NavBar`) **may** set a default that composes via `Last.use`.
- Leaf Views typically ship a default DOM impl; override with `Layer.succeed(Tag, impl)` at the edge when swapping.
- No default ⇒ required; must be provided before use.

---

## Base `Link`: `to` + `out`

| Prop | Role |
|------|------|
| `to` | In-app only — **typesafe**: {@link Route.PathsOf} literal, urlBuilder result, or `(urls) => urls.group.route(…)`. **Bare `string` banned.** Runs {@link Link.To}. |
| `out` | External / free-form URL — runs {@link Link.Out} (default: follow `<a href>`). |

**Handlers + View** (`last-ts/Link`):

| Key | Role |
|-----|------|
| `Link.To` | `Context.Reference<Handler>` — in-app activation (default: `Router.go`) |
| `Link.Out` | `Context.Reference<Handler>` — external activation (default: no soft-nav) |
| `Link.View` | `View.make` with default `<a>` — clickable chrome |

Override with `Layer.succeed` on `Last.provider` / `RouterBuilder` compose / `Last.link(…, layer)`.

**Canonical:** derive Link in the **same module as the router**:

```ts
export class App extends Router.make("app").add(…) {}
export const Link = Router.link(App)
```

At each use site: **`to` xor `out`**. Prefer **`Last.link`** wrappers when narrowing; otherwise the derived `Link`.

```ts
<Link to="/">Home</Link>
<Link to={(u) => u.docs.chapter("routing")}>Routing</Link>
<Link out="https://effect.website">Effect</Link>
// @ts-expect-error bare string
<Link to="/not-in-catalog" />
```

---

## `Last.link` (track 1)

**Not** a service / `Context.Reference` / `View.make` class. **`const` helper** that wraps with `Link`.

- Pass a **regular component** → returns a **regular component**
- Pass an **effect-based component** → returns an **effect-based component**
- Pass **no component** → returns a narrowed **`Link`** that still wraps `children`
- Optional trailing **`Layer`** — local `Link.To` / `Out` / `View` overrides

Name: **`Last.link`** (not `View.link`) — sits with `Last.use` / `Last.provider`; does not mint a View tag.

### Overloads

```ts
import * as Last from "last-ts/Last"

// Wrap a base component
const DocsItem = Last.link(Site.Site, Item.Item, opts)

// No component — narrowed Link, still wraps children
const DocsLink = Last.link(Site.Site, opts)
const ChapterLink = Last.link(Site.Site, { to: (u) => u.docs.chapter })
```

### Modes

**A. Direct** — link fixed at creation; result has **no** `to`/`out` props:

```ts
Last.link(Site.Site, Brand, { to: (u) => u.index() })
Last.link(Site.Site, { out: "https://effect.website" })
Last.link(Site.Site, { to: (u) => u.docs.chapter("routing") }) // handler called → direct
```

**B. Attribute** — result accepts link props; wrapper builds `Link`:

```ts
// can enable both; each use still to xor out
Last.link(Site.Site, Item.Item, { to: true, out: true })
```

### Narrowing `to` (catalog scope)

| `opts.to` | Meaning |
|-----------|---------|
| `true` | Attribute: full-catalog `to` (string or urls callback) |
| `(u) => u.docs` (group) | Attribute: `to` only selects routes in that group |
| `(u) => u.docs.chapter` (**uncalled** route) | Attribute: route **params are component props**; **`query` is one prop** |
| `(u) => u.docs.chapter("routing")` (**called**) | Direct link to that URL |
| omitted with `out: true` / `out: URL` | External attribute or direct |

### Params + `query` as props (uncalled route)

Same shapes the router / urlBuilder already use for that route:

- **Path params** → **individual props** (e.g. `slug`)
- **Query** → **one prop** `query`

```tsx
const ChapterLink = Last.link(Site.Site, {
  to: (u) => u.docs.chapter, // uncalled
})

<ChapterLink slug="routing">Routing</ChapterLink>
<ChapterLink slug="routing" query={{ tab: "api" }}>Routing</ChapterLink>
```

```tsx
const DocsLink = Last.link(Site.Site, {
  to: (u) => u.docs, // group
})

<DocsLink to={(docs) => docs.chapter("routing")}>Routing</DocsLink>
<DocsLink to={(docs) => docs.index()}>Docs home</DocsLink>
```

```tsx
const HomeLink = Last.link(Site.Site, { to: (u) => u.index() })

<HomeLink>Home</HomeLink>
```

### With a base component

```tsx
const DocsItem = Last.link(Site.Site, Item.Item, { to: (u) => u.docs })

<DocsItem to={(docs) => docs.chapter("routing")}>Routing</DocsItem>
```

Base component props **intersect** link-channel props on the result. At runtime,
link keys (`to` / `out` / route params / anchor chrome) feed the anchor; the rest
go to the wrapped component.

---

## Content vs structure

- Structure: leaf Views (DOM) + `Last.link` wrappers.
- Content: `Context.Service` bags (e.g. `SiteCopy`) or other non-UI services.
- Composition View wires content → leaf / link props. No hardcoded `href="/…"`.

---

## Track 2 — router-scoped context (ENG’D)

**Status:** Eng’d — demo [`examples/last/router-context/`](../../examples/last/router-context/) · twoslash [`last-ts-router-context`](../examples/last/last-ts-router-context.md)  
**Replaces:** hand-rolled `Last.provider(layer, Site)` for app chrome when the catalog owns scope

### One-sentence

**Contexts are declared on the router (catalog / group / route); RouterBuilder owes the Layers those contexts require (same debt shape as `Layout.provide`); the router mounts the active scope; `Last.use(Router, …)` reads it.**

### Shipped end-state

```ts
// 1) Declare scopes on the catalog (definition)
class App extends Router.make("app")
  .context(Site) // root — Last.ServicesOf<Site> enters catalog R
  .add(
    Router.group("docs")
      .context(DocsKit) // group debt
      .add(Route.get("chapter", "/docs/:slug")),
  ) {}

// 2) Builder — handlers + layout + **context Layers** (compile-time required)
const docs = pipe(
  RouterBuilder.group(App, "docs", (h) =>
    h.handle("chapter", Chapter),
  ),
  Layout.provide(DocsLayout),
  Last.provideContext(DocsKit, docsKitLayer),
)

const root = pipe(
  RouterBuilder.layer(App), // still requires every group Layer
  Layer.provideMerge(Layer.mergeAll(main, docs)), // keep kit services
  Last.provideContext(Site, siteLayer), // discharges root Site debt
)

// 3) One edge bake — no Last.provider(layer, Site); provideMerge keeps kit services
export const Provider = Last.provider(
  pipe(Memory.layer, Layer.provideMerge(root)),
)

// 4) Use anywhere under the match
const { NavBar } = Last.use(App)                 // active merge (recommended)
const docsBag = Last.use(App, "docs")
const chapterBag = Last.use(App, (r) => r.docs.chapter)
const { Root } = Last.use(NavBar.NavBarContext)  // track 1 still works
```

Until `Last.provideContext` fulfills each declared scope, **`routesLayer` keeps those services in `R`** — you cannot bake a clean Layer with open debt (same loudness as missing `Layout.provide` on a page group).

### Declare (definition site — not a free-floating Provider)

| Scope | Meaning | Wrap | Builder debt |
|-------|---------|------|--------------|
| **Catalog (root)** | Every page under this router | Outermost context bridge | `Last.ServicesOf<RootCtx>` on `RouterBuilder.layer` |
| **Group** | That group’s routes | Around group match tree | Same on `RouterBuilder.group` Layer `R` |
| **Route** | One route | Around page body | On that route’s handler / group fulfill path |

Sketch:

```ts
class Site extends Router.make("app")
  .context(RootContext)
  .add(
    Router.group("docs")
      .context(DocsContext)
      .add(
        Route.get("chapter", "/docs/:slug"),
        // .context(ChapterContext) // optional
      ),
  ) {}
```

### Builder debt — mirror `Layout.provide`

| Piece | Layout today | Context dream |
|-------|--------------|---------------|
| Declare need | page group implies `Layout.Slot` | `.context(Ctx)` stamps scope + `ServicesOf<Ctx>` into `R` |
| Discharge | `pipe(group, Layout.provide(AppLayout))` | `pipe(group, Last.provideContext(Ctx, implLayer))` |
| Loud failure | open `Layout.Slot` → can’t bake clean Layer | open context services → can’t bake clean Layer |
| Override | later `Layout.provide` / `yield*` | later `Last.provideContext` wins for that scope |
| Defaults | View Reference defaults + `Layer.succeed` for required Services | same — `Last.provideContext(Site, siteCopyLayer)` discharges `ServicesOf<Site>` while Views use Reference defaults |

**Fulfill shape (picked):**

1. **`Last.provideContext(kit)`** — excludes Layer outputs from `R`  
2. **`Last.provideContext(Ctx, kit)`** — excludes `ServicesOf<Ctx>` (preferred when Views are References with defaults)

Catalog attach stays on the router definition; **fulfill stays on the builder** so handler modules own the heavy imports (codesplit-friendly).

**Hard UI:** leaf Views own DOM; composition / Tree / `Layout.make` body = zero HTML; never name surfaces “shell” / “Chrome”.

### Use

```ts
Last.use(Router)                           // active merged bag (route ▷ group ▷ root) — recommended default
Last.use(Router, "docs")                   // explicit group id
Last.use(Router, (r) => r.docs)            // group via catalog tree
Last.use(Router, (r) => r.docs.chapter)    // route (uncalled)
```

Track 1 `Last.use(NavBarContext)` still works under the mounted bridge.

### Merge

**route > group > catalog**. Only the **active match path** mounts; inactive groups/routes do not wrap the tree and should not load their context modules.

### Size & load time (hard)

| Rule | Why |
|------|-----|
| **Active path only** | Mount providers for catalog + matched group + matched route only |
| **Root stays thin** | Catalog context = shared chrome/copy; heavy bags on group/route |
| **Debt on builder, not catalog file** | `.context(Ctx)` should be type/stamp only; `Context.provide(layer)` lives next to handlers so kits aren’t eagerly imported from `Router.make` |
| **One Atom / Layer runtime** | Context scopes = bag bridges under existing `Last.provider(layer)` — not nested Layer providers |
| **Selectors type-thin** | `(r) => r.docs.chapter` must not pull page bodies |
| **Measure** | Lean route navigation must not download inactive group context chunks |

**Forbidden:** provide every group context at root “for simplicity”; put every View Layer into the catalog module.

### Build plan (how we Eng the dream)

| Phase | Ship | Proof |
|-------|------|-------|
| **T2a — types + debt** | `.context(Ctx)` stamps; `ServicesOf` flows into `RouterBuilder.group` / `layer` `R`; incomplete provide fails typecheck | `.test-d.ts` — missing `Context.provide` errors; happy path `R = never` |
| **T2b — fulfill pipeable** | `Context.provide(layer)` (Layout dual) registers fulfilled scope on the group/catalog Layer | unit: Layer build includes context tags |
| **T2c — runtime mount** | Soft-nav match → mount catalog→group→route bag bridges (active path only) | memory router test: `Last.use` sees bags; sibling group not mounted |
| **T2d — `Last.use(Router, …)`** | bare = active merge; string group; `(r) => group \| route` selectors | type + runtime tests |
| **T2e — dogfood** | Port context-link demo off hand `Last.provider(layer, Site)` (+ spine/Last site already `Last.provider(layer)` only) | **Eng’d** — context-link uses `.context` + `Last.provideContext`; home SSR has no `data-docs` |
| **T2f — docs** | Twoslash dream page; lock status → Eng’d; Examples hub | **Eng’d** — guide [`last-context.md`](../guides/last-context.md) · hub [Examples → UI](../examples.md#ui) |

**Do not** Eng T2c before T2a/b — runtime without debt is how apps silently ship half-provided kits.

### Resolved at Eng

1. **`Last.use(Router)` alone** — active merge of mounted scopes.  
2. **Fulfill name** — `Last.provideContext` (not Effect `Context.provide` / `Last.provide`).  
3. **Attach API** — `.context(Ctx)` on catalog/group (+ route annotation ready) + builder fulfill.  
4. **Per-route** — `ContextScope` on route annotations works at runtime; typed route `.context` can follow.

### Non-goals (track 2)

- `/repo` viewer / editor  
- Merging Layout + Context into one API  
- Dropping track 1 partial `Last.provider(Ctx)` for tests  

---

## Forbidden recap

- `Context.Service` for component slots
- DOM in composition Views / `Tree` / `Layout.make` body (beyond placing `<Tree />`)
- Hardcoded `href="/…"` instead of `Link` / `Last.link`
- Bare `string` on Link `to` — use {@link Route.PathsOf} / urlBuilder callback on `Router.link(Catalog)`; free-form URLs → `out`
- Treating `Last.link` as a View/service/Tag
- `Site.layer` / static `layer` / `bag.layer`
- Flattened `NavBarView` on `Site`
- Word **Chrome** for this surface
- `Site.Site.use()` — use `Last.use(Site.Site)`
- Eng’ing track 2 before track 1 was locked (track 1 is now tip-synced)

---

## Eng status

| Piece | Status |
|-------|--------|
| Phase A site Frame kits (current tree) | **Eng’d** — `docs/last/site` `ui/*` View kits + `Site.context(SiteKit)` + Twoslash [`rsc-router.md`](../last/rsc-router.md) |
| Track 1: `Last.context` / `provider` / `use` + `Last.link` + `Link` `out` | **Eng’d** — `test/last-context-link.test.tsx` · demo [`examples/last/context-link/`](../../examples/last/context-link/) · twoslash [`last-ts-context-link`](../examples/last/last-ts-context-link.md) |
| Track 2: router/builder-scoped provide | **Eng’d** — `test/last-router-context.test.tsx` · demo [`examples/last/router-context/`](../../examples/last/router-context/) · twoslash [`last-ts-router-context`](../examples/last/last-ts-router-context.md) |
| **T2e dogfood** | **Eng’d** — context-link edge is `Last.provider(layer)` only; docs kit mounts on `/docs` |
| **T2f docs** | **Eng’d** — guide [`../guides/last-context.md`](../guides/last-context.md) |

---

## Acceptance (track 1)

1. `Last.context` + nested region contexts; `Last.provider(Site)`; `Last.use(Site)` / `Last.use(NavBarContext)`.
2. Every component slot is a View.
3. Composition Views / Tree contain no DOM tags.
4. `Last.link`: direct vs attribute; group / uncalled route / called route narrowing; params as props; `query` singular prop; no-component overload.
5. Base `Link` supports `out`; prefer `Last.link` over raw `Link`.
6. `import * as` only for last-ts modules.
