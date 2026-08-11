# Page.make mint (owner lock)

**Status:** Eng’d on `cursor/agent-k-page-route-6d0e`  
**Package:** `last-ts` (`Page`, `Route.static`)  
**Related:** [`page-document-lock.md`](./page-document-lock.md) · [`page-layout-lock.md`](./page-layout-lock.md) · [`router-httpapi-lock.md`](./router-httpapi-lock.md)

## One-sentence lock

**`Page.make` / `Page.static` mint a pipeable page (options + bake mode + default body). Path comes only from the file (`fileRouter`). No path on the mint.**

## Surface

| API | Role |
|-----|------|
| `Page.make(default)` / `Page.make(options, default)` | Dynamic page; default = JSX \| component \| Effect |
| `Page.static(…)` | Sugar — same mint with mode `"static"` |
| `page.pipe(Route.static)` | Make an **existing** page static (class: define class, then pipe — not in `extends`) |
| Path | fileRouter / file path only |

## Naming

- Effects / piped values: **camelCase** (`about`, `aboutStatic`)
- Classes / components: **PascalCase**
- Never PascalCase a `const` unless it is a component

## Examples

```ts
export class Home extends Page.make(<h1>Home</h1>) {}

export class About extends Page.make(
  Effect.gen(function* () {
    yield* Page.document(Document.title("About"))
    return <h1>About</h1>
  }),
) {}

export const aboutStatic = About.pipe(Route.static)

export class Pricing extends Page.static(<h1>Pricing</h1>) {}

export class Chapter extends Page.make(
  { params: { slug: Schema.String } },
  Effect.gen(function* () {
    const req = yield* Page.Request
    return <h1>{req.params.slug}</h1>
  }),
) {}
```

## Host

Page bodies are written against soft-nav / `Page.Props` (nested `params`).  
`fileRouter` / `paths.gen` stay **path-only** (no mode codegen).

**Do not teach** app-authored Waku `createPages` / `createRoot` / `Server.fromPage` lists —
that is host-engine glue, not product API. Product registration is the Page mint + catalog.

## Forbidden

- Path argument on `Page.make` / `Page.static`
- `extends Page.make(…).pipe(Route.static)` (pipe after the class)
- PascalCase consts for piped pages (`AboutStatic` → `aboutStatic`)
- Teaching JSX-element / legacy extras as `RouterBuilder.handle` product paths — **component or Effect** (or a Page mint; builder unwraps `.default`)

## HttpApi dual

Mint is value + class base (Pipeable), same family as `HttpApi.make` / `Router.make`.
