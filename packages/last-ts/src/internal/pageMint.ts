/**
 * Page.make / Page.static mint — pipeable class base (HttpApi dual).
 *
 * @internal
 */
import * as errors from "./errors";
import * as React from "react";
import { Effect } from "effect";
import { type Pipeable, pipeArguments } from "effect/Pipeable";
import type { RequestOptions } from "./routeRequest";
import type * as pageServices from "./pageServices";
import { hasBrand } from "./predicates";

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
  // The render contract: hosts and the Outlet hand every page component the matched
  // HandleArgs; narrower author props (`{ params: { slug } }`) are supertypes of it.
  | React.ComponentType<HandleArgs>
  // The one requirement a page Effect may declare: the matched Request. Hosts and the
  // Outlet both provide it, so the channel is honest instead of `unknown`-erased.
  | Effect.Effect<React.ReactNode, never, pageServices.Request>;

/** Loose render args every page component can rely on (mirrors ../Route.HandleArgs). */
export type HandleArgs = {
  readonly params: Record<string, string>;
  readonly query: Record<string, string>;
  readonly pathname: string;
  readonly href: string;
};

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
  typeof u === "function" && hasBrand(u, TypeId);

const isOptionsBag = (u: unknown): u is RequestOptions => {
  if (u === null || typeof u !== "object") return false;
  if (React.isValidElement(u)) return false;
  if (Effect.isEffect(u)) return false;
  return true;
};

const makeProto = <
  Options extends RequestOptions,
  M extends Mode,
>(options: {
  readonly options: Options;
  readonly mode: M;
  readonly default: Default;
}): AnyPage<Options, M> => {
  class PageMint {}
  return Object.assign(PageMint, {
    [TypeId]: TypeId,
    options: options.options,
    mode: options.mode,
    default: options.default,
    pipe(this: AnyPage) {
      // eslint-disable-next-line prefer-rest-params -- pipeArguments(this, arguments)
      return pipeArguments(this, arguments);
    },
  });
};

type Body =
  | React.ReactElement
  // `never` props: accepts a component of ANY props shape (contravariance) — the host
  // adapts the actual props (soft-nav `params` bags, Waku flats) at render time.
  | React.ComponentType<never>
  | Effect.Effect<React.ReactNode, never, pageServices.Request>;

type MakeOverload = {
  <const O extends RequestOptions, P extends object>(
    options: O,
    body:
      | React.ComponentType<P>
      | React.ReactElement
      | Effect.Effect<React.ReactNode, never, pageServices.Request>,
  ): AnyPage<O, "dynamic">;
  (
    body: Body,
  ): AnyPage<RequestOptions, "dynamic">;
};

type StaticOverload = {
  <const O extends RequestOptions, P extends object>(
    options: O,
    body:
      | React.ComponentType<P>
      | React.ReactElement
      | Effect.Effect<React.ReactNode, never, pageServices.Request>,
  ): AnyPage<O, "static">;
  (
    body: Body,
  ): AnyPage<RequestOptions, "static">;
};

const parseArgs = (
  first: RequestOptions | Default,
  second?: Default,
): { readonly options: RequestOptions; readonly default: Default } => {
  // Runtime dispatch fills the overload gap: an options bag routes the two-arg form,
  // anything else is the page default; a mismatched shape fails loudly.
  if (second === undefined) {
    if (isOptionsBag(first)) {
      throw new errors.PageMakeArguments();
    }
    return { options: {}, default: first };
  }
  if (!isOptionsBag(first)) {
    throw new errors.PageMakeArguments();
  }
  return { options: first, default: second };
};

// The overload objects correlate the options generic with the two-argument form —
// TypeScript cannot check a single implementation against that correlation, so the
// dispatchers validate their argument shapes at runtime (parseArgs throws
// PageMakeArguments on a mismatch) and the export is narrowed by a predicate.
const minter = <M extends Mode>(mode: M) =>
  (first: RequestOptions | Default, second?: Default): AnyPage<RequestOptions, M> => {
    const parsed = parseArgs(first, second);
    return makeProto({
      options: parsed.options,
      mode,
      default: parsed.default,
    });
  };

const isMakeOverload = (u: unknown): u is MakeOverload => typeof u === "function";
const isStaticOverload = (u: unknown): u is StaticOverload =>
  typeof u === "function";

const makeDispatch = minter("dynamic");
if (!isMakeOverload(makeDispatch)) {
  throw new errors.InvariantViolated({ what: "Page.make dispatcher must be callable" });
}
/** @internal */
export const make: MakeOverload = makeDispatch;

const staticDispatch = minter("static");
if (!isStaticOverload(staticDispatch)) {
  throw new errors.InvariantViolated({ what: "Page.static dispatcher must be callable" });
}
/** @internal */
export const static_: StaticOverload = staticDispatch;

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
