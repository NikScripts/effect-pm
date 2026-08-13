# Last.context + View UI kits (owner lock)

**Status:** LOCK (design) — not Eng’d  
**Branch:** `cursor/agent-k-page-route-6d0e`  
**Package:** `last-ts`  
**Related:** [`page-layout-lock.md`](./page-layout-lock.md) · [`last-provider-lock.md`](./last-provider-lock.md) · [`router-httpapi-lock.md`](./router-httpapi-lock.md)

## One-sentence lock

**Component DI is `View`. Group Views (and non-UI services) with `Last.context`. Bridge with `Last.provider(Context)` + `Last.use(Context)`. Pure DOM lives only on leaf Views; composition Views have zero DOM tags.**

---

## Hard rules

| Rule | Detail |
|------|--------|
| Component ⇒ **View** | If the service value is a React component, it is a **View** — not `Context.Service`. Same DI job; use `View.make`. |
| `Context.Service` | Only for **non-component** values (e.g. copy / config bags). |
| Leaf Views own DOM | Pure HTML (`header`, `a`, `aside`, …) lives in the leaf View default (or provided impl). |
| Composition Views | **Zero** DOM tags — only compose other Views / `Last.use` results / content services. |
| No `href="/…"` in kits | In-app URLs go through **`Link`** (`to`). External URLs use **`Link`** (`out`). |
| No `.layer` API on context | No `Site.layer`, no `bag.layer(…)`, no `static layer` on classes. Plain `Layer.succeed` / `Layer.mergeAll` at the edge when binding impls. |
| No “Chrome” | Banned name (see layout lock). |
| `import * as` | All last-ts and local modules: `import * as NavBar from "./NavBar"`, then `NavBar.NavBarContext`. |
| API shape | `Last.context` / `Last.provider(Context)` / `Last.use(Context)` — not `Site.use()` methods, not `Site.Site.use()`. |

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

## Link: `to` + `out`

**Today:** `Router.Link` / Waku `Link` take **`to`** (in-app soft-nav).

**Expand:**

| Prop | Role |
|------|------|
| `to` | In-app destination — string or `(urls) => string`; soft-nav / `go` |
| `out` | External URL — plain navigation (no router `go`); use for leaving the app |

Rules:

- Pass **`to` xor `out`** (not both; not neither when the leaf is a link).
- **No raw `href="/…"`** in region kits — always `Link` with `to` / `out`.
- `className` / `children` / a11y props unchanged.

```tsx
<Link.Link to={urls.index()}>Home</Link.Link>
<Link.Link out="https://effect.website">Effect</Link.Link>
```

Exact module surface stays `import * as Router` / `import * as Waku` (or a shared `Link` re-export) — Eng picks one product path; behavior above is the lock.

---

## Content vs structure

- Structure: leaf Views (DOM / `Link`).
- Content: `Context.Service` bags (e.g. `SiteCopy`) or other non-UI services.
- Composition View wires content → leaf props (`to` / `out` / children). Never bake copy or paths into leaf defaults unless the leaf is purely presentational chrome with props.

---

## Router-scoped provide (later, additive)

Same `Last.context` / `Last.use` model. **Additional place to attach Layers** on the builder (rename TBD — **not** `SiteBuilder`; must stay generic for HttpApi + pages):

| Scope | Idea |
|-------|------|
| Whole catalog | provide on builder `layer(api)` |
| Group | provide on `group(…)` |
| Route | provide on that handle |

`Last.use(Service)` uses the **active** merge (route > group > router). Optional overload `Last.use(Router, selector?)` for explicit scope — **does not change** the context API above.

---

## Forbidden recap

- `Context.Service` for component slots
- DOM in composition Views / `Tree` / `Layout.make` body (beyond placing `<Tree />`)
- Hardcoded `href="/…"` instead of `Link` `to` / `out`
- `Site.layer` / static `layer` / `bag.layer`
- Flattened `NavBarView` on `Site`
- Word **Chrome** for this surface
- `Site.Site.use()` — use `Last.use(Site.Site)`

---

## Eng status

| Piece | Status |
|-------|--------|
| Phase A site Frame kits (current tree) | Eng’d earlier — **superseded by this lock** for next cut |
| `Last.context` / `Last.provider(Context)` / `Last.use` | **Not Eng’d** |
| Link `out` | **Not Eng’d** |
| Builder rename + route/group provide | Parked; additive |

---

## Acceptance (when Eng’d)

1. `Last.context` + nested region contexts; `Last.provider(Site)`; `Last.use(Site)` / `Last.use(NavBarContext)`.
2. Every component slot is a View.
3. Composition Views / Tree contain no DOM tags.
4. In-app links use `to`; external use `out`; no bare `href="/"` in kits.
5. `import * as` only for last-ts modules.
