/**
 * Runtime: last-ts JSX + View.gen alongside Radix / shadcn-style wrappers.
 */
/** @jsxImportSource last-ts */
import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Layer } from "effect";
import type * as React from "react";
import { Dialog as DialogPrimitive, Label } from "radix-ui";
import { renderToString } from "react-dom/server";
import * as View from "last-ts/View";

class Greeter extends Context.Service<Greeter, string>()("test/jsx-rt/Greeter") {}

/** shadcn-style thin Root wrapper (mirrors `src/web/components/ui/dialog`). */
const Dialog = (
  props: React.ComponentProps<typeof DialogPrimitive.Root>,
): React.ReactElement => <DialogPrimitive.Root data-slot="dialog" {...props} />;

const DialogTrigger = (
  props: React.ComponentProps<typeof DialogPrimitive.Trigger>,
): React.ReactElement => (
  <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
);

describe("View.jsx + Radix", () => {
  it("renders bag-composed View under Radix Dialog Root + Label (SSR-safe)", () => {
    const Child = View.gen(function* () {
      const name = yield* Greeter;
      return (_props: {}) => <span data-testid="child">{name}</span>;
    });

    const Page = View.succeed({ Child }, ({ Child }) => (_props: {}) => (
      <Dialog open>
        <DialogTrigger>Open</DialogTrigger>
        {/* Content portals don't SSR — nest under Root + Label instead */}
        <div data-slot="dialog-body">
          <Label.Root>Greeting</Label.Root>
          <h1>Hello</h1>
          <Child />
        </div>
      </Dialog>
    ));

    const App = View.mount(Page, Layer.succeed(Greeter, "nik"));
    const html = renderToString(<App />);
    expect(html).toContain("nik");
    expect(html).toContain("Hello");
    expect(html).toContain("Greeting");
    expect(html).toContain("data-slot=\"dialog-trigger\"");
    expect(html).toContain("data-slot=\"dialog-body\"");
  });

  it("View.gen void becomes () => null", () => {
    const Empty = View.gen(function* () {
      yield* Effect.void;
    });
    const App = View.mount(Empty, Layer.empty);
    expect(renderToString(<App />)).toBe("");
  });

  it("plain outside button still renders under last-ts jsx", () => {
    const Outside = (props: { readonly label: string }) => (
      <button type="button">{props.label}</button>
    );
    const Page = View.succeed((_props: {}) => (
      <div>
        <Outside label="radix-free" />
      </div>
    ));
    const App = View.mount(Page, Layer.empty);
    expect(renderToString(<App />)).toContain("radix-free");
  });
});
