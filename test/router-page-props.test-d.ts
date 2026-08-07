/**
 * PageProps + typed RouterBuilder.handle — schema-true page components.
 */
import { describe, expectTypeOf, it } from "@effect/vitest";
import { Schema } from "effect";
import { HttpApiEndpoint } from "effect/unstable/httpapi";
import type { Layout } from "last-ts/Layout";
import * as Route from "last-ts/Route";
import * as Router from "last-ts/Router";
import * as RouterBuilder from "last-ts/RouterBuilder";
import type * as React from "react";

const RootLayout: Layout = ({ children }) => children as React.ReactElement;

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

    const _layer = RouterBuilder.group(Site, "docs", RootLayout, (h) =>
      h
        .handle("index", () => null as unknown as React.ReactElement)
        .handle("chapter", Chapter),
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

    const _layer = RouterBuilder.group(Site, "docs", RootLayout, (h) =>
      h
        .handle("index", () => null as unknown as React.ReactElement)
        .handle(
          "chapter",
          // @ts-expect-error — params.id:number is not chapter:string
          Wrong,
        ),
    );
    void _layer;
  });
});
