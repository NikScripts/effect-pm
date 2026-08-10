# Layout + RootLayout (owner lock)

**Status:** Eng’d — design SSOT + cutover on `cursor/agent-k-page-route-6d0e`  

**Branch:** `cursor/agent-k-page-route-6d0e`  
**Date:** 2026-08-10  
**Package:** `last-ts`  
**Related:** [`page-document-lock.md`](./page-document-lock.md) · [`router-httpapi-lock.md`](./router-httpapi-lock.md) · [`last-ts-api-corrections.md`](./last-ts-api-corrections.md)  
**Supersedes lean in:** [`page-layout-design.md`](./page-layout-design.md) where it disagrees (esp. `Layout.Root.make`, `{ layout: false }`, positional layout on `group`)

## One-sentence lock

**Layouts are View-shaped Context handles:** `Layout.make` / `RootLayout.make` mint a
`Context.Reference` whose default is a **zero-prop React component**; page groups
**require** a layout slot in `R`; fulfill / override with **`Layout.provide`**
(Layer-pipeable or fiber-scoped `yield*`) — never a positional `group` arg, never
`{ layout: false }`.

---

## Forbidden

| Banned | Use instead |
|--------|-------------|
| `Layout.Root.make` / nested `Layout.Root` namespace | **`RootLayout.make`** (`import * as RootLayout`) |
| `RouterBuilder.group(api, id, layout, build)` (4-arg) | **`group(api, id, build)`** + `Layout.provide` |
| `.layout(AppShell).handle(…)` as the product story | `Layout.provide` on the group Layer / in Effects |
| `{ layout: false }` on `handle` | `yield* Layout.provide(Passthrough)` (or another layout) in that page |
| Teaching `({ children }) => …` as the product layout API | `Layout.make` + `<Layout.Outlet />` |
| Word **chrome** in APIs/docs for this surface | layout / shell / root as needed |
| `typeof` for layout typing | pass the **class** |
| Named imports | `import * as Layout` / `import * as RootLayout` |

---

## Modules

| Module | Owns |
|--------|------|
| `last-ts/Layout` | `Layout.make`, `Layout.Outlet`, `Layout.Passthrough`, `Layout.provide`, group layout slot types |
| `last-ts/RootLayout` | `RootLayout.make`, package `Default` — owns `<html>`, applies `Document.Fields` to html attrs, renders `Document.Head` + `<Layout.Outlet />` |
| `last-ts/RouterBuilder` | `group(api, id, build)` only — HttpApi-shaped; page groups leave layout slot in `R` |

---

## Effect model (Reference, not a “default Layer”)

Same as `View.make(key, default)` / `Document.Head`:

- **`Context.Reference`** — `defaultValue` is lazy + cached on the key; always carried.
- **Override** — put another impl in Context (`Layout.provide` / Layer); lookup uses the map entry.
- **Required slot (page groups)** — group Layer’s `R` includes that group’s **layout slot** with **no silent skip**. You must `Layout.provide(SomeLayout)` (may be `Passthrough`).
- **Json-only groups** — no layout slot in `R`.

`yield* AppShell` / resolving the slot yields a **zero-prop `React.FC`** (not a raw Effect). The component uses `<Layout.Outlet />` for the page body.

---

## `RootLayout.make`

```ts
import * as RootLayout from "last-ts/RootLayout"
import * as Layout from "last-ts/Layout"
import * as Document from "last-ts/Document"

export class SiteRoot extends RootLayout.make()(
  "app/layout/root",
  Effect.fn(function* () {
    const Head = yield* Document.Head
    const { lang } = yield* Document.Fields
    return (
      <html lang={lang ?? "en"}>
        <head>
          <meta charSet="utf-8" />
          <Head />
        </head>
        <body>
          <Layout.Outlet />
        </body>
      </html>
    )
  }),
) {}
```

- **`lang` (and later `dir` / html class)** live on `Document.Fields`; root **reads** them onto `<html>` — not head tags.
- Document provider mounts once at the root boundary (see Document lock); nested layouts do not re-wrap.
- Swap root via Layer / Reference override — same family as Layout.

---

## `Layout.make` (body)

```ts
import * as Layout from "last-ts/Layout"
import * as Page from "last-ts/Page"
import * as Document from "last-ts/Document"

export class AppShell extends Layout.make()(
  "app/layout/app",
  Effect.fn(function* () {
    yield* Page.document(
      Document.titleTransform((t) => `${t} · Docs`),
    )
    return (
      <div className="shell">
        <nav />
        <main>
          <Layout.Outlet />
        </main>
      </div>
    )
  }),
) {}
```

- No `<html>` / `<head>`.
- **`Layout.Passthrough`** — package `Layout.make` that is only `<Layout.Outlet />` (explicit “bare” shell).

---

## `RouterBuilder.group` + `Layout.provide`

```ts
// HttpApi-shaped — three args
const appGroup = pipe(
  RouterBuilder.group(Site, "app", (h) =>
    h.handle("home", Home).handle("bare", Bare),
  ),
  Layout.provide(AppShell), // required for page groups; sets group default
)

pipe(
  RouterBuilder.layer(Site),
  Layer.provide(appGroup),
)
```

### `Layout.provide`

| Form | Role |
|------|------|
| `pipe(groupLayer, Layout.provide(AppShell))` | Layer pipeable — discharges the group’s layout slot; **no** outer `Layer.provide(Layout.…)` |
| `yield* Layout.provide(Passthrough)` | Fiber/scoped override while a page (or other Effect) runs |

- Group identity is carried by the group Layer brand — **`Layout.provide(AppShell)`** arity (not `(Site, "app", AppShell)`).
- Override = another `Layout.provide(Other)` later in the pipe or inside an Effect.
- Page with no shell: `yield* Layout.provide(Layout.Passthrough)` (or group default is Passthrough).

---

## Outlet

```tsx
<Layout.Outlet />
```

Component, not a yielded child value. Distinct from `Router.Outlet` (route match host).

---

## Accumulation with Document

Body / root Effects may `yield* Page.document(…)`. Field merge rules stay in [`page-document-lock.md`](./page-document-lock.md). Root applies html-level fields (`lang`, …) when rendering `<html>`.

---

## Eng’d

- `last-ts/RootLayout` — `make`, `Default`, `Tag`
- `last-ts/Layout` — `make`, `Outlet`, `Passthrough`, `provide`, `Slot`
- `RouterBuilder.group(api, id, build)` only; page groups require `Layout.Slot`
- Dogfood `_root.tsx` uses `RootLayout.Default`; site catalog uses `Layout.provide(Passthrough)`

---

## Out of scope / later

- Multi-group layout inheritance beyond “each page group has its own slot.”
- Catalog-level layout annotation (rejected — keep Router data-only).
- Renaming `Router.Outlet` (stays; `Layout.Outlet` is the in-layout slot).

---

## Acceptance (when Eng’d)

1. No 4-arg `group`; no `{ layout: false }`; no `Layout.Root.make`.
2. Page-group Layer without `Layout.provide` ⇒ type/missing-service failure.
3. `pipe(group, Layout.provide(A))` then `Layout.provide(B)` / `yield* Layout.provide(B)` overrides.
4. `RootLayout` reads `Document.Fields.lang` onto `<html>`.
5. `import *` only; apps never import `waku`.
