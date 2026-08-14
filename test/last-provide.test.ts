/**
 * Last.provide — entry-point Effect.provide + run (Services are Effects).
 */
import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Layer } from "effect";
import * as React from "react";
import { renderToString } from "react-dom/server";
import * as Last from "last-ts/Last";
import * as View from "last-ts/View";

class Greeter extends Context.Service<Greeter, string>()(
  "hyperlink-ts/test/last-provide.test/Greeter",
) {
  static layer = Layer.succeed(Greeter, "hello");
}

describe("Last.provide", () => {
  it("fulfills a Service via Effect.provide(Service, Service.layer)", () => {
    expect(Last.provide(Greeter, Greeter.layer)).toBe("hello");
  });

  it("composes open-R Service.layer with requirements", () => {
    class Open extends Context.Service<Open, string>()(
      "hyperlink-ts/test/last-provide.test/Open",
    ) {
      static layer = Layer.effect(Open, Greeter);
    }
    expect(
      Last.provide(Open, Layer.provide(Open.layer, Greeter.layer)),
    ).toBe("hello");
  });

  it("runs an Effect with R=never", () => {
    expect(Last.provide(Effect.succeed(42))).toBe(42);
  });

  it("runs an Effect with requirements", () => {
    const program = Effect.map(Greeter, (s) => s.toUpperCase());
    expect(Last.provide(program, Greeter.layer)).toBe("HELLO");
  });

  it("fulfills a View Service to a render fn", () => {
    class Page extends View.make<Page>()("test/last-provide/Page") {
      static layer = Layer.succeed(Page, (_props: {}) =>
        React.createElement("h1", null, "body"),
      );
    }
    const App = View.stamp(Last.provide(Page, Page.layer));
    expect(renderToString(React.createElement(App))).toContain("body");
  });
});
