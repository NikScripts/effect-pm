/**
 * group.fromEffect / groupsFromEffect — UrlBuilder + bake R stay typed.
 */
import { expectTypeOf } from "vitest";
import { Context, Effect, Layer, Schema, pipe } from "effect";
import * as Layout from "last-ts/Layout";
import * as Route from "last-ts/Route";
import * as Router from "last-ts/Router";
import * as RouterBuilder from "last-ts/RouterBuilder";

class SiteMode extends Context.Service<
  SiteMode,
  { readonly tenancy: "org" }
>()("hyperlink-ts/test/ui-from-effect-typed.test-d/SiteMode") {}

class FeatureModules extends Context.Service<
  FeatureModules,
  { readonly billing: true }
>()("hyperlink-ts/test/ui-from-effect-typed.test-d/FeatureModules") {}

const project = Route.get("project", "/o/:org/projects/:id", {
  params: { org: Schema.String, id: Schema.String },
});

const appSync = Route.group("app").fromEffect(
  Effect.succeed([project] as const),
);
// Infer all Group slots — `Routes` is `in out`; `any` there fails `extends`.
type AppSyncRoutes = typeof appSync extends Route.Group<
  infer _Id,
  infer Routes,
  infer _Groups,
  infer _Top,
  infer _R
> ? Routes["identifier"]
  : never;
expectTypeOf<AppSyncRoutes>().toEqualTypeOf<"project">();

const app = Route.group("app").fromEffect(
  Effect.gen(function* () {
    yield* SiteMode;
    return [project] as const;
  }),
);
type AppR = typeof app extends Route.Group<
  infer _Id,
  infer _Routes,
  infer _Groups,
  infer _Top,
  infer R
> ? R
  : never;
expectTypeOf<AppR>().toEqualTypeOf<SiteMode>();

const Site = Router.make("typed-from-effect")
  .add(Route.get("home", "/"), app)
  .groupsFromEffect(
    Effect.gen(function* () {
      yield* FeatureModules;
      return [
        Route.group("billing").add(
          Route.get("plans", "/billing/plans"),
          Route.get("invoice", "/billing/invoices/:id", {
            params: { id: Schema.String },
          }),
        ),
      ] as const;
    }),
  );

type SiteR = Router.Api.Context<typeof Site>;
expectTypeOf<SiteR>().toEqualTypeOf<SiteMode | FeatureModules>();

type Urls = Route.UrlBuilder<typeof Site>;
declare const urls: Urls;

// Type-level links (identifiers + path arity from fromEffect Items)
expectTypeOf(urls.home()).toEqualTypeOf<string>();
expectTypeOf(urls.app.project("acme", "42")).toEqualTypeOf<string>();
expectTypeOf(urls.billing.plans()).toEqualTypeOf<string>();
expectTypeOf(urls.billing.invoice("inv_1")).toEqualTypeOf<string>();

// @ts-expect-error invoice needs id
urls.billing.invoice();

// @ts-expect-error project needs org + id
urls.app.project();

const home = pipe(
  RouterBuilder.group(Site, "__top", (h) =>
    h.handle("home", () => null),
  ),
  Layout.provide(Layout.Passthrough),
);

const appHandlers = pipe(
  RouterBuilder.group(Site, "app", (h) =>
    h.handle("project", () => null),
  ),
  Layout.provide(Layout.Passthrough),
);

const routes = pipe(
  RouterBuilder.layer(Site),
  Layer.provide(Layer.mergeAll(home, appHandlers)),
);

type LayerR = typeof routes extends Layer.Layer<any, any, infer R> ? R
  : never;
type _HasSiteMode = [SiteMode] extends [LayerR] ? true : false;
type _HasModules = [FeatureModules] extends [LayerR] ? true : false;
expectTypeOf<true>().toEqualTypeOf<_HasSiteMode>();
expectTypeOf<true>().toEqualTypeOf<_HasModules>();
