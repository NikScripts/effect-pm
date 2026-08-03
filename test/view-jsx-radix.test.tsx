/**
 * Runtime: last-ts JSX + View.gen alongside Radix / shadcn-style wrappers.
 */
/** @jsxImportSource last-ts */
import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Layer } from "effect";
import { Atom } from "effect/unstable/reactivity";
import type * as React from "react";
import { Dialog as DialogPrimitive, Label } from "radix-ui";
import { renderToString } from "react-dom/server";
import * as AtomReact from "last-ts/AtomReact";
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

const renderWithRuntime = (
  node: React.ReactElement,
  layer: Layer.Layer<never, never, never> | Layer.Layer<Greeter, never, never>,
): string => {
  // AtomRuntime is invariant in R; stamp through never for the provider prop.
  const runtime = Atom.runtime(layer) as Atom.AtomRuntime<never>;
  return renderToString(
    <AtomReact.RegistryProvider>
      <AtomReact.RuntimeProvider runtime={runtime}>{node}</AtomReact.RuntimeProvider>
    </AtomReact.RegistryProvider>,
  );
};

describe("View.jsx + Radix", () => {
  it("renders View.gen nested under Radix Dialog Root + Label (SSR-safe)", () => {
    const Child = View.gen(function* () {
      const name = yield* Greeter;
      return (_props: {}) => <span data-testid="child">{name}</span>;
    });

    const Page = View.gen(function* () {
      return (_props: {}) => (
        <Dialog open>
          <DialogTrigger>Open</DialogTrigger>
          {/* Content portals don't SSR — nest under Root + Label instead */}
          <div data-slot="dialog-body">
            <Label.Root>Greeting</Label.Root>
            <h1>Hello</h1>
            <Child />
          </div>
        </Dialog>
      );
    });

    const html = renderWithRuntime(<Page />, Layer.succeed(Greeter, "nik"));
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
    expect(renderWithRuntime(<Empty />, Layer.empty)).toBe("");
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
    expect(renderWithRuntime(<Page />, Layer.empty)).toContain("radix-free");
  });
});
