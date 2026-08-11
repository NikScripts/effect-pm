/**
 * @module examples/last/spine/demo
 *
 * Twoslash SSOT for the spine acceptance demo — same APIs as the runnable Waku app
 * under `src/` (`pnpm run example:last-spine` → http://localhost:5230).
 *
 * Handoff: `docs/handoffs/last-ts-spine.md`
 * Docs: `docs/examples/last/last-ts-spine.md`
 */
import type { ReactNode } from "react";
import { Effect, Layer, pipe, Schema } from "effect";
import * as Document from "last-ts/Document";
import * as Last from "last-ts/Last";
import * as Layout from "last-ts/Layout";
import * as Page from "last-ts/Page";
import * as Route from "last-ts/Route";
import * as Router from "last-ts/Router";
import * as RouterBuilder from "last-ts/RouterBuilder";
import * as Server from "last-ts/server";
import * as Waku from "last-ts/Waku";

// =============================================================================
// 1. Page mints — path from the file only (never on the mint)
// =============================================================================

/** Path `/` — static JSX body. */
export class Home extends Page.static(
  <article data-page="home">
    <h1>last-ts spine</h1>
    <p>
      Acceptance demo — <code>Page.make</code> / <code>Server.fromPage</code> /{" "}
      catalog / <code>Document.provide</code> / <code>Last.provider</code>.
    </p>
  </article>,
) {}

/**
 * Path `/about` — `Page.make` with an Effect body (dynamic bake).
 * Host RSC runs Effects via `Effect.runPromise` (not client `View.effect`).
 */
export class About extends Page.make(
  Effect.succeed(
    <article data-page="about">
      <h1>About</h1>
      <p>
        <code>Page.make(Effect)</code> body — host runs it with{" "}
        <code>Effect.runPromise</code>.
      </p>
    </article>,
  ),
) {}

/** Path `/guides/[slug]` — soft-nav props `{ params, query, pathname, href }`. */
export class Chapter extends Page.static(
  {
    params: { slug: Schema.Literals(["routing", "provider"]) },
  },
  (props: { readonly params: { readonly slug: string } }) => (
    <article data-page="chapter">
      <h1>Guide · {props.params.slug}</h1>
      <p>
        Nested <code>params.slug</code> — soft-nav and RSC share one shape.
      </p>
    </article>
  ),
) {}

// =============================================================================
// 2. Soft-nav catalog — paths align with fileRouter `paths.gen`
// =============================================================================

export class Site extends Router.make("last-ts/spine").add(
  Route.get("index", "/"),
  Route.get("about", "/about"),
  Route.get("guides_slug", "/guides/:slug", {
    params: { slug: Schema.Literals(["routing", "provider"]) },
  }),
) {}

export const urls = Route.urlBuilder(Site);

const app = pipe(
  RouterBuilder.group(Site, "__top", (h) =>
    h
      .handle("index", Home)
      .handle("about", About)
      .handle("guides_slug", Chapter),
  ),
  Layout.provide(Layout.Passthrough),
);

export const routes = pipe(RouterBuilder.layer(Site), Layer.provide(app));

// =============================================================================
// 3. Document.provide — title + titleTransform required
// =============================================================================

export class SpineDocument extends Document.make()(
  "last-ts/spine/document",
  Effect.gen(function* () {
    const { title, titleTransform, description, links, styles } =
      yield* Document.Fields;
    const resolved = titleTransform(title);
    return (
      <>
        <title>{resolved}</title>
        {description !== undefined ? (
          <meta name="description" content={description} />
        ) : null}
        {links.map((l, i) => (
          <link key={`l-${i}`} rel={l.rel} href={l.href} media={l.media} />
        ))}
        {styles.map((css, i) => (
          <style key={`s-${i}`}>{css}</style>
        ))}
      </>
    );
  }),
) {}

export const spineDocumentLayer = Document.provide(
  SpineDocument,
  Document.title("last-ts spine"),
  Document.titleTransform((t: string) =>
    t === "last-ts spine" ? t : `${t} · last-ts spine`,
  ),
  Document.description("Minimal last-ts spine acceptance demo"),
  Document.lang("en"),
  Document.styleSheet("/styles.css"),
);

// =============================================================================
// 4. Last.provider — provideMerge keeps Document.Cell in Layer output
// =============================================================================

export const Provider = Last.provider(
  pipe(
    Waku.layer,
    Layer.provide(routes),
    Layer.provideMerge(spineDocumentLayer),
  ),
);

// =============================================================================
// 5. Host — Server.fromPage(path, mint) only (no app `waku` / getConfig)
// =============================================================================

export const hostPages = Server.createPages(
  async ({ createPage, createLayout, createRoot }) => [
    createRoot({
      render: "static",
      component: () => null,
    }),
    createLayout({
      render: "static",
      path: "/",
      component: (props: { readonly children?: ReactNode }) => (
        <>{props.children}</>
      ),
    }),
    createPage({
      ...Server.fromPage("/", Home),
    }),
    createPage({
      ...Server.fromPage("/about", About),
    }),
    createPage({
      ...Server.fromPage("/guides/[slug]", Chapter),
      staticPaths: ["routing", "provider"],
    }),
  ],
);

// Typed urls used by soft-nav Links in the runnable app.
export const demoHrefs = {
  home: urls.index(),
  about: urls.about(),
  chapter: urls.guides_slug("routing"),
} as const;

// ---cut-after---
void hostPages;
void Provider;
void demoHrefs;
