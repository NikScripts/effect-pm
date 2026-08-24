/**
 * @module Layout
 *
 * Body layouts — {@link make}, {@link Outlet}, {@link Passthrough}, {@link provide}.
 * Root html: `last-ts/RootLayout`. SSOT: `docs/handoffs/page-layout-lock.md`.
 *
 * @public
 */
"use client";

import * as React from "react";
import { Context, Effect, Layer } from "effect";
import * as layoutReact from "./internal/layoutReact";

type GroupImplLike = {
  readonly layout: React.FC;
  readonly handlers: Map<string, unknown>;
};

export type BodyRender = layoutReact.BodyRender;

/**
 * Zero-prop layout component (uses {@link Outlet} for the page body).
 *
 * @public
 */
export type Layout = React.FC;

const LayoutTypeId = "~last-ts/Layout" as const;

/**
 * Minted layout class — also a {@link Context.Reference} (`yield*` → `React.FC`).
 *
 * @public
 */
export type AnyLayout = {
  readonly [LayoutTypeId]: typeof LayoutTypeId;
  readonly key: string;
  readonly render: BodyRender;
  readonly Component: React.FC;
};

/**
 * Page-group Layer requirements — fulfill with {@link provide}.
 *
 * @public
 */
export class Slot extends Context.Service<Slot, React.FC>()(
  "last-ts/Layout/Slot",
) {}

/**
 * Fiber override cell — seeded by Outlet from the group default.
 *
 * @internal
 */
export type OverrideCell = {
  readonly get: () => React.FC;
  readonly set: (layout: React.FC) => void;
};

/** @internal */
export class Override extends Context.Service<Override, OverrideCell>()(
  "last-ts/Layout/Override",
) {}

const isLayoutClass = (u: unknown): u is AnyLayout =>
  typeof u === "function" &&
  u !== null &&
  LayoutTypeId in u &&
  (u as unknown as AnyLayout)[LayoutTypeId] === LayoutTypeId;

/** Resolve a layout class or bare FC to a zero-prop component. @internal */
export const toComponent = (layout: AnyLayout | React.FC): React.FC =>
  isLayoutClass(layout) ? layout.Component : (layout as React.FC);

const isGroupImpl = (u: unknown): u is GroupImplLike =>
  typeof u === "object" &&
  u !== null &&
  "handlers" in u &&
  "layout" in u &&
  (u as GroupImplLike).handlers instanceof Map;

const patchGroupLayouts = <A,>(
  ctx: Context.Context<A>,
  component: React.FC,
): Context.Context<A> => {
  const next = new Map(ctx.mapUnsafe);
  for (const [key, value] of next) {
    if (isGroupImpl(value)) {
      next.set(key, { ...value, layout: component });
    }
  }
  return Context.makeUnsafe(next) as Context.Context<A>;
};

/**
 * Page body slot — `<Layout.Outlet />`, not a yielded value.
 *
 * @public
 */
export const Outlet: React.FC = layoutReact.Outlet;

/** @internal */
export const OutletProvider = layoutReact.OutletProvider;

/**
 * Mint a body layout — Effect → zero-prop React component with {@link Outlet}.
 *
 * @example
 * ```ts
 * export class AppShell extends Layout.make()(
 *   "app/layout/app",
 *   Effect.fn(function* () {
 *     return (
 *       <div className="shell">
 *         <main><Layout.Outlet /></main>
 *       </div>
 *     )
 *   }),
 * ) {}
 * ```
 *
 * @public
 */
export const make =
  () =>
  (
    key: string,
    render: BodyRender,
  ): (abstract new (_: never) => {}) &
    AnyLayout &
    Context.Reference<React.FC> => {
    const Component = layoutReact.makeBodyComponent(key, render);
    const reference = Context.Reference(key, {
      defaultValue: () => Component,
    });
    const Cls = class {
      static readonly [LayoutTypeId] = LayoutTypeId;
      static readonly key = key;
      static readonly render = render;
      static readonly Component = Component;
    };
    return Object.assign(Cls, reference) as unknown as (abstract new (
      _: never,
    ) => {}) &
      AnyLayout &
      Context.Reference<React.FC>;
  };

/**
 * Explicit bare shell — only {@link Outlet}.
 *
 * @public
 */
export class Passthrough extends make()(
  "last-ts/Layout/passthrough",
  Effect.sync(() => React.createElement(Outlet)),
) {}

/**
 * Layer pipeable + fiber Effect from {@link provide}.
 *
 * @public
 */
export interface ProvideOp extends Effect.Effect<void, never, Override> {
  <A, E, R>(
    self: Layer.Layer<A, E, R>,
  ): Layer.Layer<A, E, Exclude<R, Slot>>;
}

/**
 * Fulfill / override a layout slot.
 *
 * - `pipe(groupLayer, Layout.provide(AppShell))` — Layer pipeable (last wins)
 * - `yield* Layout.provide(Passthrough)` — fiber override while a page runs
 *
 * @public
 */
export const provide = (layout: AnyLayout | React.FC): ProvideOp => {
  const component = toComponent(layout);
  const effect: Effect.Effect<void, never, Override> = Effect.gen(function* () {
    const cell = yield* Override;
    cell.set(component);
  });
  const layerProvide = <A, E, R>(
    self: Layer.Layer<A, E, R>,
  ): Layer.Layer<A, E, Exclude<R, Slot>> =>
    Layer.effectContext(
      Effect.gen(function* () {
        const ctx = yield* Effect.scoped(
          Layer.build(
            Layer.provide(self, Layer.succeed(Slot, component)) as Layer.Layer<
              A,
              E,
              never
            >,
          ),
        );
        return patchGroupLayouts(ctx, component);
      }),
    ) as Layer.Layer<A, E, Exclude<R, Slot>>;

  return new Proxy(layerProvide, {
    get(target, prop, receiver) {
      if (Reflect.has(effect, prop)) {
        return Reflect.get(effect, prop, effect);
      }
      return Reflect.get(target, prop, receiver);
    },
    has(target, prop) {
      return Reflect.has(effect, prop) || Reflect.has(target, prop);
    },
    getPrototypeOf() {
      return Object.getPrototypeOf(effect);
    },
  }) as unknown as ProvideOp;
};
