/**
 * Runtime: last-ts JSX + View.gen Layers alongside Radix / shadcn-style wrappers.
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

class Page extends View.Service<Page>()("test/jsx-rt/Page") {
  static layer = View.gen(Page, function* () {
    const name = yield* Greeter;
    return (_props: {}) => (
      <Dialog open>
        <DialogTrigger>Open</DialogTrigger>
        {/* Content portals don't SSR — nest under Root + Label instead */}
        <div data-slot="dialog-body">
          <Label.Root>Greeting</Label.Root>
          <h1>Hello</h1>
          <span data-testid="child">{name}</span>
        </div>
      </Dialog>
    );
  });
}

describe("View.jsx + Radix", () => {
  it("renders View.gen under Radix Dialog Root + Label (SSR-safe)", () => {
    const App = View.mount(Page, Page.layer.pipe(Layer.provide(Layer.succeed(Greeter, "nik"))));
    const html = renderToString(<App />);
    expect(html).toContain("nik");
    expect(html).toContain("Hello");
    expect(html).toContain("Greeting");
    expect(html).toContain("data-slot=\"dialog-trigger\"");
    expect(html).toContain("data-slot=\"dialog-body\"");
  });

  it("View.gen void becomes () => null", () => {
    class Empty extends View.Service<Empty>()("test/jsx-rt/Empty") {
      static layer = View.gen(Empty, function* () {
        yield* Effect.void;
      });
    }
    const App = View.mount(Empty, Empty.layer);
    expect(renderToString(<App />)).toBe("");
  });

  it("View.succeed Layer mounts a plain component Service", () => {
    class Outside extends View.Service<Outside, { readonly label: string }>()(
      "test/jsx-rt/Outside",
    ) {
      static layer = View.succeed(Outside, (props) => (
        <button type="button">{props.label}</button>
      ));
    }
    class Wrap extends View.Service<Wrap>()("test/jsx-rt/Wrap") {
      static layer = View.gen(Wrap, function* () {
        const O = yield* Outside;
        return (_props: {}) => (
          <div>
            <O label="radix-free" />
          </div>
        );
      });
    }
    const App = View.mount(
      Wrap,
      Wrap.layer.pipe(Layer.provide(Outside.layer)),
    );
    expect(renderToString(<App />)).toContain("radix-free");
  });
});
