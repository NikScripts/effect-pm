/**
 * Route.fromEffect / staticFromEffect / mixedFromEffect — literal param bags →
 * schema phantoms + bake metadata. No manual render annotations at the call site.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { dual } from "effect/Function";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { Constraint } from "./route";
import * as route from "./route";

/**
 * One concrete path-param bag (literal fields). Union of these is the route’s
 * params Type — not a struct of field-unions.
 *
 * @public
 */
export type ParamBag = { readonly [key: string]: string };

/**
 * Stored on the endpoint for adapters (SSG expand / typed recovery).
 *
 * @internal
 */
export type FromEffectValue = {
  /** All literal bags (static ∪ dynamic) — params Type / typed links. */
  readonly effect: Effect.Effect<ReadonlyArray<ParamBag>>;
  /** When true, some rows bake (see {@link bake}). */
  readonly static: boolean;
  /**
   * Rows to expand for SSG. Defaults to {@link effect} when `static` and
   * omitted; empty when fully dynamic.
   */
  readonly bake?: Effect.Effect<ReadonlyArray<ParamBag>>;
};

/**
 * Annotation — Effect of literal param bags (+ whether they bake).
 *
 * @internal
 */
export class FromEffect extends Context.Service<FromEffect, FromEffectValue>()(
  "last-ts/Route/FromEffect",
) {}

/**
 * Phantom schema whose Type is the row union. Runtime decode is structural
 * (string record); adapters prefer {@link FromEffect} rows for bake.
 *
 * @internal
 */
type BagsSchema<Bags extends ParamBag> = Schema.Top & {
  readonly Type: Bags;
};

const bagsSchema = <Bags extends ParamBag>(): BagsSchema<Bags> =>
  Schema.Record(Schema.String, Schema.String) as unknown as BagsSchema<Bags>;

/**
 * Endpoint branded with a literal param-bag union.
 *
 * Uses `~ParamBags` (not `~Params`) so it does not collapse against
 * HttpApiEndpoint’s `Params = never` intersection.
 *
 * @public
 */
export type WithParamBags<E extends Constraint, Bags extends ParamBag> = E & {
  readonly "~ParamBags": Bags;
  readonly "~Params": BagsSchema<Bags>;
};

const attach = <E extends Constraint, Bags extends ParamBag>(
  self: E,
  effect: Effect.Effect<ReadonlyArray<Bags>>,
  isStatic: boolean,
  bake?: Effect.Effect<ReadonlyArray<ParamBag>>,
): WithParamBags<E, Bags> => {
  const next = route.params(self, bagsSchema<Bags>());
  return next.annotate(FromEffect, {
    effect: effect as Effect.Effect<ReadonlyArray<ParamBag>>,
    static: isStatic,
    ...(bake !== undefined ? { bake } : {}),
  }) as unknown as WithParamBags<E, Bags>;
};

/**
 * Attach typed param rows from an Effect (dynamic — typed links / SSR).
 * Helper derives the params phantom; no manual schema annotations.
 *
 * ```ts
 * Route.get("chapter", "/guides/:slug").pipe(
 *   Route.fromEffect(Effect.succeed([
 *     { slug: "routing" as const },
 *     { slug: "view-service" as const },
 *   ])),
 * )
 * ```
 *
 * @public
 */
export const fromEffect: {
  <Bags extends ParamBag>(
    effect: Effect.Effect<ReadonlyArray<Bags>>,
  ): <E extends Constraint>(self: E) => WithParamBags<E, Bags>;
  <E extends Constraint, Bags extends ParamBag>(
    self: E,
    effect: Effect.Effect<ReadonlyArray<Bags>>,
  ): WithParamBags<E, Bags>;
} = dual(
  2,
  <E extends Constraint, Bags extends ParamBag>(
    self: E,
    effect: Effect.Effect<ReadonlyArray<Bags>>,
  ): WithParamBags<E, Bags> => attach(self, effect, false),
);

/**
 * Like {@link fromEffect}, but those literal rows are SSG-baked (static).
 * `Route.get` stays the dynamic default; this is the opt-in.
 *
 * ```ts
 * Route.get("chapter", "/guides/:slug").pipe(
 *   Route.staticFromEffect(loadChapterRows),
 * )
 * ```
 *
 * @public
 */
export const staticFromEffect: {
  <Bags extends ParamBag>(
    effect: Effect.Effect<ReadonlyArray<Bags>>,
  ): <E extends Constraint>(self: E) => WithParamBags<E, Bags>;
  <E extends Constraint, Bags extends ParamBag>(
    self: E,
    effect: Effect.Effect<ReadonlyArray<Bags>>,
  ): WithParamBags<E, Bags>;
} = dual(
  2,
  <E extends Constraint, Bags extends ParamBag>(
    self: E,
    effect: Effect.Effect<ReadonlyArray<Bags>>,
  ): WithParamBags<E, Bags> => attach(self, effect, true),
);

/**
 * Two closed literal sets on one route — both param-literal bags (no
 * `Literal | String`). Params Type = static ∪ dynamic; only `static` rows bake.
 *
 * ```ts
 * Route.get("chapter", "/guides/:slug").pipe(
 *   Route.mixedFromEffect({
 *     static: Effect.succeed([{ slug: "routing" as const }]),
 *     dynamic: Effect.succeed([{ slug: "draft" as const }]),
 *   }),
 * )
 * ```
 *
 * @public
 */
export const mixedFromEffect: {
  <S extends ParamBag, D extends ParamBag>(options: {
    readonly static: Effect.Effect<ReadonlyArray<S>>;
    readonly dynamic: Effect.Effect<ReadonlyArray<D>>;
  }): <E extends Constraint>(self: E) => WithParamBags<E, S | D>;
  <E extends Constraint, S extends ParamBag, D extends ParamBag>(
    self: E,
    options: {
      readonly static: Effect.Effect<ReadonlyArray<S>>;
      readonly dynamic: Effect.Effect<ReadonlyArray<D>>;
    },
  ): WithParamBags<E, S | D>;
} = dual(
  2,
  <E extends Constraint, S extends ParamBag, D extends ParamBag>(
    self: E,
    options: {
      readonly static: Effect.Effect<ReadonlyArray<S>>;
      readonly dynamic: Effect.Effect<ReadonlyArray<D>>;
    },
  ): WithParamBags<E, S | D> => {
    const combined = Effect.zipWith(
      options.static,
      options.dynamic,
      (s, d) => [...s, ...d],
    );
    return attach(
      self,
      combined,
      true,
      options.static as Effect.Effect<ReadonlyArray<ParamBag>>,
    );
  },
);

/** Read {@link FromEffect} annotation if present. @internal */
export const fromEffectOf = (
  self: Constraint,
): FromEffectValue | undefined =>
  Option.getOrUndefined(Context.getOption(self.annotations, FromEffect));
