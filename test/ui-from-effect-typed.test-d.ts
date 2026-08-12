/**
 * CMS-style fromEffect / groupsFromEffect — UrlBuilder params + query + bake R.
 */
import { expectTypeOf } from "vitest";
import { Context, Effect, Layer, Schema, pipe } from "effect";
import * as Layout from "last-ts/Layout";
import * as Route from "last-ts/Route";
import * as Router from "last-ts/Router";
import * as RouterBuilder from "last-ts/RouterBuilder";

class Cms extends Context.Service<
  Cms,
  { readonly variants: true; readonly docs: true }
>()("hyperlink-ts/test/ui-from-effect-typed.test-d/Cms") {}

const product = Route.get("product", "/products/:sku", {
  params: { sku: Schema.String },
  query: { ref: Schema.optionalKey(Schema.String) },
});

const variant = Route.get("variant", "/products/:sku/v/:variant", {
  params: { sku: Schema.String, variant: Schema.String },
  query: { ref: Schema.optionalKey(Schema.String) },
});

const article = Route.get("article", "/:locale/blog/:slug", {
  params: {
    locale: Schema.Literals(["en", "de"]),
    slug: Schema.String,
  },
  query: { preview: Schema.optionalKey(Schema.String) },
});

const content = Route.group("content").fromEffect(
  Effect.gen(function* () {
    yield* Cms;
    return [product, variant, article] as const;
  }),
);

type ContentR = typeof content extends Route.Group<
  infer _Id,
  infer _Routes,
  infer _Groups,
  infer _Top,
  infer R
> ? R
  : never;
expectTypeOf<ContentR>().toEqualTypeOf<Cms>();

const Site = Router.make("typed-cms-from-effect")
  .add(Route.get("home", "/"), content)
  .groupsFromEffect(
    Effect.gen(function* () {
      yield* Cms;
      return [
        Route.group("docs").add(
          Route.get("guide", "/docs/:version/:slug", {
            params: { version: Schema.String, slug: Schema.String },
            query: { q: Schema.optionalKey(Schema.String) },
          }),
        ),
      ] as const;
    }),
  );

type SiteR = Router.Api.Context<typeof Site>;
expectTypeOf<SiteR>().toEqualTypeOf<Cms>();

type Urls = Route.UrlBuilder<typeof Site>;
declare const urls: Urls;

expectTypeOf(urls.home()).toEqualTypeOf<string>();
expectTypeOf(
  urls.content.product("sku_1", { query: { ref: "hero" } }),
).toEqualTypeOf<string>();
expectTypeOf(
  urls.content.variant("sku_1", "red", { query: { ref: "grid" } }),
).toEqualTypeOf<string>();
expectTypeOf(
  urls.content.article("en", "launch", { query: { preview: "1" } }),
).toEqualTypeOf<string>();
expectTypeOf(
  urls.docs.guide("v2", "routing", { query: { q: "layer" } }),
).toEqualTypeOf<string>();

// @ts-expect-error product needs sku
urls.content.product();

// @ts-expect-error variant needs sku + variant
urls.content.variant("sku_1");

// @ts-expect-error article needs locale + slug
urls.content.article("en");

const home = pipe(
  RouterBuilder.group(Site, "__top", (h) =>
    h.handle("home", () => null),
  ),
  Layout.provide(Layout.Passthrough),
);

const contentHandlers = pipe(
  RouterBuilder.group(Site, "content", (h) =>
    h
      .handle("product", () => null)
      .handle("variant", () => null)
      .handle("article", () => null),
  ),
  Layout.provide(Layout.Passthrough),
);

const routes = pipe(
  RouterBuilder.layer(Site),
  Layer.provide(Layer.mergeAll(home, contentHandlers)),
);

type LayerR = typeof routes extends Layer.Layer<any, any, infer R> ? R
  : never;
type _HasCms = [Cms] extends [LayerR] ? true : false;
expectTypeOf<true>().toEqualTypeOf<_HasCms>();
