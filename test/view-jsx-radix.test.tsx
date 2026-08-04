/**
 * Runtime: last-ts JSX + Layer.effect alongside Radix / shadcn-style wrappers.
 */
/** @jsxImportSource last-ts */
import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Layer } from "effect";
import type * as React from "react";
import { Dialog as DialogPrimitive, Label } from "radix-ui";
import { renderToString } from "react-dom/server";
import * as View from "last-ts/View";

class Greeter extends Context.Service<Greeter, string>()("test/jsx-rt/Greeter") {}

const Dialog = (
  props: React.ComponentProps<typeof DialogPrimitive.Root>,
): React.ReactElement => <DialogPrimitive.Root data-slot="dialog" {...props} />;

const DialogTrigger = (
  props: React.ComponentProps<typeof DialogPrimitive.Trigger>,
): React.ReactElement => (
  <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
);

class Page extends View.Service<Page>()("test/jsx-rt/Page") {
  static layer = Layer.effect(
    Page,
    Effect.gen(function* () {
      const name = yield* Greeter;
      return (_props: {}) => (
        <Dialog open>
          <DialogTrigger>Open</DialogTrigger>
          <div data-slot="dialog-body">
            <Label.Root>Greeting</Label.Root>
            <h1>Hello</h1>
            <span data-testid="child">{name}</span>
          </div>
        </Dialog>
      );
    }),
  ).pipe(Layer.provide(Layer.succeed(Greeter, "nik")));
}

describe("View.jsx + Radix", () => {
  it("renders under Radix Dialog Root + Label (SSR-safe)", () => {
    const App = View.mount(Page);
    const html = renderToString(<App />);
    expect(html).toContain("nik");
    expect(html).toContain("Hello");
    expect(html).toContain("Greeting");
    expect(html).toContain("data-slot=\"dialog-trigger\"");
    expect(html).toContain("data-slot=\"dialog-body\"");
  });

  it("Effect.gen void becomes () => null", () => {
    class Empty extends View.Service<Empty>()("test/jsx-rt/Empty") {
      static layer = Layer.effect(
        Empty,
        Effect.gen(function* () {
          yield* Effect.void;
          return () => null;
        }),
      );
    }
    const App = View.mount(Empty);
    expect(renderToString(<App />)).toBe("");
  });

  it("Layer.succeed mounts a plain component Service", () => {
    class Outside extends View.Service<Outside, { readonly label: string }>()(
      "test/jsx-rt/Outside",
    ) {
      static layer = Layer.succeed(Outside, (props) => (
        <button type="button">{props.label}</button>
      ));
    }
    class Wrap extends View.Service<Wrap>()("test/jsx-rt/Wrap") {
      static layer = Layer.effect(
        Wrap,
        Effect.gen(function* () {
          const O = yield* Outside;
          return (_props: {}) => (
            <div>
              <O label="radix-free" />
            </div>
          );
        }),
      ).pipe(Layer.provide(Outside.layer));
    }
    const App = View.mount(Wrap);
    expect(renderToString(<App />)).toContain("radix-free");
  });
});
