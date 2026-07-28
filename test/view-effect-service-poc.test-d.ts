/**
 * Type proof — Effect-faithful View Tag POC (`examples/forms/view/effect-service-poc`).
 */
import { expectTypeOf } from "vitest";
import type * as React from "react";
import {
  type DenseProps,
  type PropsOf,
  type ServiceOf,
  type View,
  type ViewProps,
  DenseCard,
  Greeter,
  PoolCard,
  denseSkin,
  poolSkin,
} from "../examples/forms/view/effect-service-poc";

// ── WIN: instance Service — no typeof ───────────────────────────────────────
// Effect puts Shape on ServiceClass.Shape → class instance type has `.Service`.

expectTypeOf<PoolCard["Service"]>().toEqualTypeOf<View<ViewProps>>();
expectTypeOf<ServiceOf<PoolCard>>().toEqualTypeOf<View<ViewProps>>();
expectTypeOf(poolSkin).toEqualTypeOf<PoolCard["Service"]>();

expectTypeOf<DenseCard["Service"]>().toEqualTypeOf<
  View<ViewProps & { readonly dense?: boolean }>
>();
expectTypeOf(denseSkin).toEqualTypeOf<DenseCard["Service"]>();

// Shorter than View.View<View.Type<typeof DenseCard>>:
type DenseSkin = DenseCard["Service"];
expectTypeOf<DenseSkin>().toEqualTypeOf<
  View<ViewProps & { readonly dense?: boolean }>
>();

// ── WIN: PropsOf from instance Service — no typeof ──────────────────────────

expectTypeOf<PropsOf<DenseCard>>().toEqualTypeOf<
  ViewProps & { readonly dense?: boolean }
>();
expectTypeOf<DenseProps>().toEqualTypeOf<PropsOf<DenseCard>>();
expectTypeOf<PropsOf<Greeter>>().toEqualTypeOf<{ readonly name: string }>();
expectTypeOf<PropsOf<PoolCard>>().toEqualTypeOf<ViewProps>();

// ── constructor statics ─────────────────────────────────────────────────────

expectTypeOf(PoolCard.size).toEqualTypeOf<"card">();
expectTypeOf(DenseCard.size).toEqualTypeOf<"card">();
expectTypeOf(PoolCard.key).toBeString();
expectTypeOf<(typeof PoolCard)["Service"]>().toEqualTypeOf<PoolCard["Service"]>();

// ── succeed props ───────────────────────────────────────────────────────────

type SucceedProps<T> = T extends { readonly Service: View<infer P> } ? P : never;
expectTypeOf<SucceedProps<PoolCard>>().toEqualTypeOf<ViewProps>();
expectTypeOf<SucceedProps<DenseCard>>().toEqualTypeOf<
  ViewProps & { readonly dense?: boolean }
>();

expectTypeOf(poolSkin({ tag: { key: "x" } })).toEqualTypeOf<
  React.ReactElement | null
>();
