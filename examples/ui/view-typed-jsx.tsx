/**
 * Typed JSX demo — nested View requirements (child → parent → fn).
 *
 * Docs: `docs/guides/view-typed-jsx.md` (Twoslash `^?` + live island).
 * Opt-in: `@jsxImportSource last-ts` (or tsconfig `jsxImportSource`).
 */
/** @jsxImportSource last-ts */
import { Context } from "effect";
import { Dialog as DialogPrimitive } from "radix-ui";
import type * as React from "react";
import type * as Jsx from "last-ts/Jsx";
import * as View from "last-ts/View";

// Tags the nested tree must have provided at the app Layer.
export class Greeter extends Context.Service<Greeter, string>()(
  "examples/ui/view-typed-jsx/Greeter",
) {}
export class Clock extends Context.Service<Clock, number>()(
  "examples/ui/view-typed-jsx/Clock",
) {}

/** Child View — yield* Greeter → stamped on the component’s R. */
export const Child = View.gen(function* () {
  const name = yield* Greeter;
  return (_props: {}) => <span data-demo="child">{name}</span>;
});

/** Sibling — needs Clock. */
export const Other = View.gen(function* () {
  const t = yield* Clock;
  return (_props: {}) => <span data-demo="other">t={t}</span>;
});

/**
 * shadcn-style thin wrapper over Radix — outside component, no View brand.
 * Must not break under last-ts jsx; children R still bubbles.
 */
export const Dialog = (
  props: React.ComponentProps<typeof DialogPrimitive.Root>,
): React.ReactElement => <DialogPrimitive.Root data-slot="dialog" {...props} />;

export const DialogTrigger = (
  props: React.ComponentProps<typeof DialogPrimitive.Trigger>,
): React.ReactElement => (
  <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
);

/** Page nests Child + Other under Radix — Page’s R = Greeter | Clock. */
export const Page = View.gen(function* () {
  return (_props: {}) => (
    <Dialog open>
      <DialogTrigger>Open</DialogTrigger>
      <div data-slot="dialog-body">
        <h1>Typed JSX</h1>
        <Child />
        <Other />
      </div>
    </Dialog>
  );
});

// ---cut---
// Persistent type queries — hover / read the popups below.
type PageNeeds = View.ServicesOf<typeof Page>;
//   ^?

type ChildNeeds = View.ServicesOf<typeof Child>;
//   ^?

const tree = (
  <div>
    <Child />
    <Other />
  </div>
);
type TreeNeeds = Jsx.ServicesOf<typeof tree>;
//   ^?

const throughRadix = (
  <Dialog open>
    <DialogTrigger>Open</DialogTrigger>
    <div>
      <Child />
    </div>
  </Dialog>
);
type ThroughRadixNeeds = Jsx.ServicesOf<typeof throughRadix>;
//   ^?
