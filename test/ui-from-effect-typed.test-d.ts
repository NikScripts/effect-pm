/**
 * Catalog class + fromEffect — typed links per Spec; bake R includes Catalog.
 */
import { expectTypeOf } from "vitest";
import { Layer, pipe } from "effect";
import * as Layout from "last-ts/Layout";
import * as RouterBuilder from "last-ts/RouterBuilder";
import {
  type AcmeUrls,
  type GlobexUrls,
  Catalog,
  Site,
} from "../examples/last/from-effect/Catalog";

declare const acme: AcmeUrls;
declare const globex: GlobexUrls;

// Acme — variants + locales; no docs branch
expectTypeOf(
  acme.content.product("sku_1", { query: { ref: "hero" } }),
).toEqualTypeOf<string>();
expectTypeOf(
  acme.content.variant("sku_1", "red", { query: { ref: "grid" } }),
).toEqualTypeOf<string>();
expectTypeOf(
  acme.content.article("en", "launch", { query: { preview: "1" } }),
).toEqualTypeOf<string>();

// @ts-expect-error Acme has no docs portal
acme.docs;

// @ts-expect-error locale is "en" | "de"
acme.content.article("fr", "launch");

// @ts-expect-error variant needs two path args
acme.content.variant("sku_1");

// Globex — nested docs.api.symbol; no variant
expectTypeOf(
  globex.docs.guide("v2", "routing", { query: { q: "layer" } }),
).toEqualTypeOf<string>();
expectTypeOf(
  globex.docs.api.symbol("v1", "effect", "Effect", {
    query: { src: "twoslash" },
  }),
).toEqualTypeOf<string>();

// @ts-expect-error Globex has no variant PDP
globex.content.variant;

// @ts-expect-error version is "v1" | "v2"
globex.docs.guide("v3", "routing");

// RouterBuilder.layer(Site) requires Catalog in R
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
expectTypeOf<true>().toEqualTypeOf<
  [Catalog] extends [LayerR] ? true : false
>();
