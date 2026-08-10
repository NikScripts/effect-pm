# Page.document + Document (owner lock)

**Status:** LOCK — design SSOT; **not Eng’d** until owner go  
**Branch:** `cursor/agent-k-page-route-6d0e`  
**Date:** 2026-08-10  
**Package:** `last-ts`  
**Supersedes lean in:** [`router-httpapi-lock.md`](./router-httpapi-lock.md) (`(yield* Page.Document).set`), ad-hoc `Last.provide(ShellMeta)` as product title story  
**Related:** [`last-ts-api-corrections.md`](./last-ts-api-corrections.md) · [`page-layout-design.md`](./page-layout-design.md) · host boundary in corrections

### Before you Eng

1. (Re)read `docs/standards/` (incl. `no-waku-app-imports`).
2. List concrete Eng actions; **wait for owner confirmation**. This handoff is not a go.

---

## One-sentence lock

**Document chrome is a typed field bag + a swappable head renderer.** Apps write with
`Page.document` (patches / partials). Layers fulfill requirements with
`Document.provide`. Never `yield*` inside `()`, never a mid-tree `<Title>`, never
direct `waku` head APIs.

---

## Forbidden

| Banned | Use instead |
|--------|-------------|
| `yield* (yield* Page.Document).set(…)` / any `yield*` in `()` | `yield* Page.document(…)` |
| `Document.set` / `.defaults` | `Page.document` / `Document.provide` |
| `<Page.Title>` / layout title components as the product write API | `Page.document` |
| `typeof` for Document typing | pass the **class** |
| Named imports (`{ title }`) | `import * as Document` / `import * as Page` |
| Auto-applying title to the host behind the layout’s back | Root layout renders `<Head />`; Body layouts do not invent `<html>` |
| App `import` from `waku` / `getConfig` | `last-ts/*` only |

---

## Modules

| Module | Owns |
|--------|------|
| `last-ts/Document` | `Document.make`, `Document.Head` (Reference), `Document.Fields`, `Document.transform`, sugars (`title`, `meta`, `link`, …), `Document.provide` |
| `last-ts/Page` | **`Page.document` only** (among this surface) — plus existing `Page.Request` / `Page.make` / … |
| `last-ts/Layout` | `Layout.Outlet` (**component**), `Layout.Root` (Reference + `Root.make`) |

Handlers typically:

```ts
import * as Page from "last-ts/Page"
import * as Document from "last-ts/Document"
```

---

## Document.make (Option A — class carries extras)

Per-class field extras (Effect-shaped). Active Document class = schema for patches.

```ts
import { Effect } from "effect"
import * as Document from "last-ts/Document"

export class SiteDocument extends Document.make<{
  readonly ogImage?: string
}>()(
  "app/document/site",
  Effect.fn(function* () {
    const {
      title,
      titleTransform,
      description,
      lang,
      meta,
      links,
      scripts,
      styles,
      ogImage,
    } = yield* Document.Fields

    const resolved = titleTransform(title)
    return (
      <>
        <title>{resolved}</title>
        {description !== undefined ? (
          <meta name="description" content={description} />
        ) : null}
        {/* map meta / links / scripts / styles / ogImage → head children */}
      </>
    )
  }),
)
```

- Impl is **Effect → ReactNode** (head **children** fragments), not `function Head(props)`.
- Params come from **`Document.Fields`** (injected), typed as `FieldsOf<ThisClass>`.
- **No default values on `make`.** Fulfillment is `Document.provide` via Layer.
- `Document.Head` is a **`Context.Reference`** with a package default Document; swap with Layers / `Page.document(SiteDocument, …)`.

---

## Base fields (library)

| Key | On `Document.provide` | Notes |
|-----|------------------------|--------|
| `title` | **required** | `string` |
| `titleTransform` | **required** | `(title: string) => string` (often identity) |
| `description` | optional | |
| `lang` | optional | |
| `meta` | optional → `[]` if omitted | |
| `links` | optional → `[]` | stylesheets via `rel: "stylesheet"` |
| `scripts` | optional → `[]` | |
| `styles` | optional → `[]` | inline CSS strings → `<style>` |
| class extras | per `Document.make` | required only if the class marks them required |

### v1 element shapes (tweakable before Eng)

```ts
type DocumentMeta = {
  readonly content: string
  readonly name?: string
  readonly property?: string
  readonly httpEquiv?: string
}

type DocumentLink = {
  readonly rel: string
  readonly href: string
  readonly media?: string
  readonly as?: string
  readonly type?: string
  readonly crossOrigin?: string
  readonly sizes?: string
}

type DocumentScript = {
  readonly src?: string
  readonly type?: string
  readonly async?: boolean
  readonly defer?: boolean
  readonly content?: string // inline
}
```

Lists are **always arrays** — never `T | ReadonlyArray<T>`.

---

## `Document.transform` + sugars

Primitive: branded patch `{ readonly transform: (prev: Fields) => Fields }`  
(typed for this API only — not a general Effect combinator).

```ts
Document.transform((prev) => ({ ...prev, title: "Chapter" }))
Document.transform(SiteDocument, (prev) => ({
  ...prev,
  ogImage: "/og.png",
}))
```

Sugars are built **only** from `Document.transform`:

| Sugar | Behavior |
|-------|----------|
| `Document.title(s)` | set `title` |
| `Document.titleTransform(fn)` | set `titleTransform` |
| `Document.description(s \| undefined)` | set `description` |
| `Document.lang(s)` | set `lang` |
| `Document.meta(entry)` | **append** to `meta` |
| `Document.link(entry)` | **append** to `links` |
| `Document.styleSheet(href, opts?)` | sugar → `link` with `rel: "stylesheet"` |
| `Document.style(css)` | **append** to `styles` |
| `Document.script(…)` | **append** to `scripts` |

**Merge:** helper = append one list item; object form key = **replace** that key; custom `transform` does either explicitly. Scalar keys = nearer wins. Fold left → right.

---

## `Page.document` (Effect write — only public page write)

```ts
// Against current Document.Head Reference
yield* Page.document(...patches)
yield* Page.document(partial, ...patches)

// Pin class (scope Head + tighten Fields) — class argument, never typeof
yield* Page.document(SiteDocument, ...patches)
yield* Page.document(SiteDocument, partial, ...patches)
```

- Partials / patches typed as `Partial<FieldsOf<D>>` / `Patch<D>`.
- **Partial merge** onto the already-provided bag (from Layer `Document.provide` + outer writes).
- Never teach yielding `Document` / `.set` on a service.

---

## `Document.provide` (Layer fulfill)

```ts
Document.provide(
  SiteDocument,
  Document.title("last.ts"),
  Document.titleTransform((t) =>
    t === "last.ts" ? t : `${t} · last.ts`,
  ),
  Document.lang("en"),
  Document.styleSheet("/styles.css"),
)
```

- Layer-level; composes / overrides like Layers.
- After fold, result must be a **complete** `FieldsOf<Doc>` (all **required** keys present). Optional lists omitted → `[]`.
- Normal app path: provide once at the edge; pages use `Page.document({ … })` / patches without repeating the class. `Page.document(SiteDocument, …)` is for mid-tree Head swap + typed extras.

---

## Layout

### Outlet

**Component**, not a yielded child value:

```tsx
<body>
  <Layout.Outlet />
</body>
```

### Root (`Layout.Root` Reference)

Default root layout owns `<html>`, mounts Document provider **once**, renders Head:

```tsx
export class SiteRoot extends Layout.Root.make()(
  "app/layout/root",
  Effect.fn(function* () {
    const Head = yield* Document.Head
    return (
      <html lang="en">
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
)
```

- Nested / body layouts do **not** re-install the Document provider.
- Document fields are **not** auto-applied to the host: the active Document render (`<Head />`) is the apply site inside the root layout.
- Body layouts may `yield* Page.document(…)` to contribute fields; they don’t render `<html>` / `<head>` unless they are the Root.

Swap root with Layers (`SiteRoot.layer`), same family as `Document.Head`.

---

## Accumulation

**Order:** `Document.provide` (Layer base) → layout `Page.document` → page `Page.document`.  
**Per key:** nearer wins (scalars / replaced arrays).  
**Append sugars:** add to the list at that level; omit key ⇒ keep outer list.

---

## Provider edge (sketch)

```ts
export const Provider = Last.provider(
  pipe(
    Waku.layer, // transport — last-ts/Waku only
    Layer.provide(routes),
    Layer.provide(SiteRoot.layer),
    Layer.provide(
      Document.provide(
        SiteDocument,
        Document.title("last.ts"),
        Document.titleTransform((t) =>
          t === "last.ts" ? t : `${t} · last.ts`,
        ),
        Document.lang("en"),
      ),
    ),
  ),
)
```

---

## Out of scope / later

- Full Eng of `Document` / `Layout.Root` modules (this file is design lock only).
- Per-attribute completeness of meta/link/script (v1 table above is enough to start).
- File-router standards pass; single-provider teaching polish; Hyperlink `docs/site` cutover.
- React write hooks / `<Title>` — rejected for v1.

---

## Acceptance (when Eng’d)

1. No public teaching of `(yield* Document)` / `.set` / `yield*` in `()`.
2. `Page.document` + `Document.transform` sugars typecheck against class extras.
3. `Document.provide` incomplete required fields ⇒ **type error**.
4. Dogfood root uses `Layout.Root` + `Document.Head`; no hardcoded product title story divorced from `Page.document`.
5. Apps still never import `waku`.
