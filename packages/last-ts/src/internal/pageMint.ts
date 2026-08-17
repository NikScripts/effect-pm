/**
 * Page.make / Page.static mint — pipeable class base (HttpApi dual).
 *
 * @internal
 */
import * as React from "react";
import { Effect } from "effect";
import { type Pipeable, pipeArguments } from "effect/Pipeable";
import type { RequestOptions } from "./routeRequest";

export const TypeId = "~last-ts/Page" as const;

export type Mode = "static" | "dynamic";

/**
 * Default body for a page mint.
 *
 * Props components are accepted via {@link make} / {@link static_} overloads
 * (host/Outlet supply props at runtime).
 *
 * @public
 */
export type Default =
  | React.ReactElement
  | React.ComponentType
  | Effect.Effect<React.ReactNode, unknown, unknown>;

/**
 * Page mint — value + class base.
 *
 * @public
 */
export interface AnyPage<
  out Options extends RequestOptions = RequestOptions,
  out M extends Mode = Mode,
> extends Pipeable {
  new(_: never): Record<never, never>;
  readonly [TypeId]: typeof TypeId;
  readonly options: Options;
  readonly mode: M;
  /** JSX | component | Effect — unwrapped by RouterBuilder / Server.fromPage. */
  readonly default: Default;
}

export const isPage = (u: unknown): u is AnyPage =>
  typeof u === "function" &&
  u !== null &&
  TypeId in u &&
  (u as AnyPage)[TypeId] === TypeId;

const isOptionsBag = (u: unknown): u is RequestOptions => {
  if (u === null || typeof u !== "object") return false;
  if (React.isValidElement(u)) return false;
  if (Effect.isEffect(u)) return false;
  return true;
};

const pageProto = {
  [TypeId]: TypeId,
  pipe(this: AnyPage) {
    // eslint-disable-next-line prefer-rest-params -- pipeArguments(this, arguments)
    return pipeArguments(this, arguments);
  },
};

const makeProto = <
  Options extends RequestOptions,
  M extends Mode,
>(options: {
  readonly options: Options;
  readonly mode: M;
  readonly default: Default;
}): AnyPage<Options, M> => {
  function PageMint() {}
  Object.setPrototypeOf(PageMint, pageProto);
  return Object.assign(PageMint, {
    [TypeId]: TypeId,
    options: options.options,
    mode: options.mode,
    default: options.default,
  }) as unknown as AnyPage<Options, M>;
};

type Body =
  | React.ReactElement
  // `never` props: accepts a component of ANY props shape (contravariance) — the host
  // adapts the actual props (soft-nav `params` bags, Waku flats) at render time.
  | React.ComponentType<never>
  | Effect.Effect<React.ReactNode, unknown, unknown>;

type MakeOverload = {
  <const O extends RequestOptions, P extends object>(
    options: O,
    body: React.ComponentType<P> | React.ReactElement | Effect.Effect<
      React.ReactNode,
      unknown,
      unknown
    >,
  ): AnyPage<O, "dynamic">;
  (
    body: Body,
  ): AnyPage<RequestOptions, "dynamic">;
};

type StaticOverload = {
  <const O extends RequestOptions, P extends object>(
    options: O,
    body: React.ComponentType<P> | React.ReactElement | Effect.Effect<
      React.ReactNode,
      unknown,
      unknown
    >,
  ): AnyPage<O, "static">;
  (
    body: Body,
  ): AnyPage<RequestOptions, "static">;
};

const parseArgs = (
  args: ReadonlyArray<unknown>,
): { readonly options: RequestOptions; readonly default: Default } => {
  if (args.length === 1) {
    return { options: {}, default: args[0] as Default };
  }
  const [first, second] = args;
  if (isOptionsBag(first)) {
    return { options: first, default: second as Default };
  }
  throw new Error(
    "Page.make: expected Page.make(default) or Page.make(options, default)",
  );
};

/** @internal */
export const make = ((...args: ReadonlyArray<unknown>) => {
  const parsed = parseArgs(args);
  return makeProto({
    options: parsed.options,
    mode: "dynamic",
    default: parsed.default,
  });
}) as MakeOverload;

/** @internal */
export const static_ = ((...args: ReadonlyArray<unknown>) => {
  const parsed = parseArgs(args);
  return makeProto({
    options: parsed.options,
    mode: "static",
    default: parsed.default,
  });
}) as StaticOverload;

/** @internal */
export const remintStatic = <
  Options extends RequestOptions,
  M extends Mode,
>(
  self: AnyPage<Options, M>,
): AnyPage<Options, "static"> =>
  makeProto({
    options: self.options,
    mode: "static",
    default: self.default,
  });
