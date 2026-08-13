# Last.context + View UI kits (owner lock)

**Status:** LOCK — **track 1 Eng’d + tip-synced** (track 2 unparked for next Eng)  

**Branch:** `cursor/agent-k-page-route-6d0e` (same tip as `integration` after sync)  
**Package:** `last-ts`  
**Related:** [`page-layout-lock.md`](./page-layout-lock.md) · [`last-provider-lock.md`](./last-provider-lock.md) · [`router-httpapi-lock.md`](./router-httpapi-lock.md)

## One-sentence lock

**Component DI is `View`. Group kits with `Last.context` / `Last.provider` / `Last.use`. Build custom links with `Last.link` (wrap a component or a narrowed `Link`). Prefer named link components over raw `Link`.**

## Build order (two tracks)

| # | Track | Status |
|---|--------|--------|
| **1** | `Last.context` + `Last.provider(Context)` + `Last.use` + **`Last.link`** + base `Link` `to`/`out` | **Eng’d + tip-synced** |
| **2** | Adapt context tools to the **router/builder** (provide per catalog / group / route; `Last.use` active scope) | **Next** — track 1 settled; Eng when owner starts the router cut |

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
import * as Link from "last-ts/…" // Router.Link / Waku.Link — product Link
import * as SiteCopy from "../lib/SiteCopy"
import * as Urls from "../lib/urls" // urlBuilder

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

**Today:** `Router.Link` / Waku `Link` take **`to`** (in-app soft-nav).

**Expand the base link:**

| Prop | Role |
|------|------|
| `to` | In-app — string or `(urls) => string`; soft-nav / `go` |
| `out` | External URL — plain navigation (no router `go`) |

At each use site: **`to` xor `out`**. Prefer **`Last.link`** wrappers over raw `Link`.

---

## `Last.link` (track 1)

**Not** a service / `Context.Reference` / `View.make` class. **`const` helper** that wraps with `Link`.

- Pass a **regular component** → returns a **regular component**
- Pass an **effect-based component** → returns an **effect-based component**
- Pass **no component** → returns a narrowed **`Link`** that still wraps `children`

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

Base component props merge with link props (`children`, `className`, …).

---

## Content vs structure

- Structure: leaf Views (DOM) + `Last.link` wrappers.
- Content: `Context.Service` bags (e.g. `SiteCopy`) or other non-UI services.
- Composition View wires content → leaf / link props. No hardcoded `href="/…"`.

---

## Track 2 — router-scoped context (PARKED)

Do **not** Eng until track 1 ships. Reminder only:

- Provide Layers on the builder for **catalog / group / route**
- `Last.use(Service)` → active merge (route > group > router)
- Optional `Last.use(Router, selector?)` for explicit scope
- Builder rename TBD (generic for HttpApi + pages — **not** `SiteBuilder`)

---

## Forbidden recap

- `Context.Service` for component slots
- DOM in composition Views / `Tree` / `Layout.make` body (beyond placing `<Tree />`)
- Hardcoded `href="/…"` instead of `Link` / `Last.link`
- Treating `Last.link` as a View/service/Tag
- `Site.layer` / static `layer` / `bag.layer`
- Flattened `NavBarView` on `Site`
- Word **Chrome** for this surface
- `Site.Site.use()` — use `Last.use(Site.Site)`
- Eng’ing track 2 before track 1 is locked

---

## Eng status

| Piece | Status |
|-------|--------|
| Phase A site Frame kits (current tree) | Eng’d earlier — **superseded by this lock** for next cut |
| Track 1: `Last.context` / `provider` / `use` + `Last.link` + `Link` `out` | **Eng’d** — `test/last-context-link.test.tsx` · demo [`examples/last/context-link/`](../../examples/last/context-link/) · twoslash [`last-ts-context-link`](../examples/last/last-ts-context-link.md) |
| Track 2: router/builder-scoped provide | **Next** (unparked) |

---

## Acceptance (track 1)

1. `Last.context` + nested region contexts; `Last.provider(Site)`; `Last.use(Site)` / `Last.use(NavBarContext)`.
2. Every component slot is a View.
3. Composition Views / Tree contain no DOM tags.
4. `Last.link`: direct vs attribute; group / uncalled route / called route narrowing; params as props; `query` singular prop; no-component overload.
5. Base `Link` supports `out`; prefer `Last.link` over raw `Link`.
6. `import * as` only for last-ts modules.
