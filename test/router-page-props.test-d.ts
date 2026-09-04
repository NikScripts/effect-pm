/**
 * PageProps + typed RouterBuilder.handle — schema-true page components.
 */
import { describe, expectTypeOf, it } from "@effect/vitest";
import { Effect, Layer, Schema, pipe } from "effect";
import { HttpApiEndpoint } from "effect/unstable/httpapi";
import * as Layout from "last-ts/Layout";
import * as Route from "last-ts/Route";
import * as Router from "last-ts/Router";
import * as RouterBuilder from "last-ts/RouterBuilder";
import * as React from "react";

class RootShell extends Layout.make()(
  "test-d/layout/root",
  Effect.sync(() => React.createElement(Layout.Outlet)),
) {}

class Site extends Router.make("site").add(
  Router.group("docs").add(
    Route.get("index", "/docs"),
    Route.get("chapter", "/docs/:chapter", {
      params: { chapter: Schema.String },
      query: { tab: Schema.optionalKey(Schema.String) },
    }),
  ),
  Router.group("api").add(
    HttpApiEndpoint.get("getUser", "/users/:id", {
      params: { id: Schema.String },
      success: Schema.Struct({ id: Schema.String }),
    }),
  ),
) {}

describe("Router.PageProps", () => {
  it("derives params/query from catalog path", () => {
    type Props = Router.PageProps<typeof Site, "docs", "chapter">;
    expectTypeOf<Props["params"]>().toEqualTypeOf<{
      readonly chapter: string;
    }>();
    expectTypeOf<Props["query"]>().toEqualTypeOf<{
      readonly tab?: string;
    }>();
    expectTypeOf<Props["pathname"]>().toEqualTypeOf<string>();
    expectTypeOf<Props["href"]>().toEqualTypeOf<string>();
  });

  it("empty params when none declared", () => {
    type Props = RouterBuilder.PageProps<typeof Site, "docs", "index">;
    expectTypeOf<Props["params"]>().toEqualTypeOf<{}>();
  });
});

describe("RouterBuilder.handle page props", () => {
  it("accepts a page typed from PageProps", () => {
    const Chapter = (
      props: Router.PageProps<typeof Site, "docs", "chapter">,
    ): React.ReactElement =>
      props.params.chapter as unknown as React.ReactElement;

    const _layer = pipe(
      RouterBuilder.group(Site, "docs", (h) =>
        h
          .handle("index", () => null as unknown as React.ReactElement)
          .handle("chapter", Chapter),
      ),
      Layout.provide(RootShell),
    );
    void _layer;
  });

  it("rejects a page that requires the wrong params", () => {
    const Wrong = (_props: {
      readonly params: { readonly id: number };
      readonly query: {};
      readonly pathname: string;
      readonly href: string;
    }): React.ReactElement => null as unknown as React.ReactElement;

    const _layer = pipe(
      RouterBuilder.group(Site, "docs", (h) =>
        h
          .handle("index", () => null as unknown as React.ReactElement)
          .handle(
            "chapter",
            // @ts-expect-error — params.id:number is not chapter:string
            Wrong,
          ),
      ),
      Layout.provide(RootShell),
    );
    void _layer;
  });

  it("accepts Effect → ReactNode and component page handlers", () => {
    const chapterEffect = Effect.succeed(
      null as unknown as React.ReactElement,
    );
    const Index = (): React.ReactElement =>
      null as unknown as React.ReactElement;

    const _layer = pipe(
      RouterBuilder.group(Site, "docs", (h) =>
        h.handle("index", Index).handle("chapter", chapterEffect),
      ),
      Layout.provide(RootShell),
    );
    void _layer;
  });

  it("json-only group Layer has no remaining requirements", () => {
    const apiGroup = RouterBuilder.group(Site, "api", (h) =>
      h.handle("getUser", (req) => {
        const params = (req as { readonly params: { readonly id: string } })
          .params;
        return Effect.succeed({ id: params.id });
      }),
    );
    // Must be Layer<…, …, never> — no Layout.Slot debt
    const _ok: Layer.Layer<unknown, never, never> = apiGroup as Layer.Layer<
      unknown,
      never,
      never
    >;
    void _ok;
  });
});
