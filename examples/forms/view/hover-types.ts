/**
 * @module examples/forms/view/hover-types
 *
 * **Hover target** — open this file in the IDE and hover each `export type` / `export const`
 * name (and the `satisfies` expressions) to inspect full expanded types.
 *
 * Covers:
 * 1. Effect `Context.Service` baseline (what we’re stealing)
 * 2. **Shipped** `View.Card` / Prototype tags (already have instance `.Service`)
 * 3. Annotation styles: `Tag["Service"]` vs `View.Type<typeof Tag>` vs `View.View`
 * 4. POC flat `Card<Self, Props>()` for comparison
 *
 * @see docs/handoffs/view-tag-prototype.md
 */
import type * as React from "react";
import { Context, Layer } from "effect";
import * as View from "../../../src/ui/View";
import * as Poc from "./effect-service-poc";

// =============================================================================
// 1. Effect baseline — hover `Effect_Config_*`
// =============================================================================

class Config extends Context.Service<
  Config,
  { readonly port: number }
>()("hyperlink-ts/examples/forms/view/hover-types/Config") {}

/** F-bounded Self — identity brand (R channel). */
export type Effect_Config_Self = Config;

/** Constructor / Context key. */
export type Effect_Config_Ctor = typeof Config;

/**
 * Instance `.Service` = Shape (no typeof).
 * Hover: `{ readonly port: number }`
 */
export type Effect_Config_InstanceService = Config["Service"];

/**
 * Constructor `.Service` — same Shape.
 * Hover: `{ readonly port: number }`
 */
export type Effect_Config_CtorService = (typeof Config)["Service"];

/** What `new Config()` would be typed as (ServiceClass.Shape metadata). */
export type Effect_Config_Instance = InstanceType<typeof Config>;

export const effect_configLayer = Layer.succeed(Config, { port: 8080 });

// =============================================================================
// 2. Shipped View — default chrome card
// =============================================================================

export class PoolCard extends View.Card.Tag<PoolCard>()(
  "hyperlink-ts/examples/forms/view/hover-types/PoolCard",
) {}

/** Instance type (Self / identity). Hover the class name above + this alias. */
export type Shipped_PoolCard_Self = PoolCard;

/** Constructor. */
export type Shipped_PoolCard_Ctor = typeof PoolCard;

/**
 * ★ Prefer this — instance Shape, **no typeof**.
 * Hover: `(props: View.ViewProps) => ReactElement | null`
 */
export type Shipped_PoolCard_Service = PoolCard["Service"];

/**
 * Same Shape via constructor (Effect Key.Service).
 * Hover: identical to instance Service
 */
export type Shipped_PoolCard_CtorService = (typeof PoolCard)["Service"];

/**
 * Phantom Props via today’s helper — **needs typeof**.
 * Hover: `View.ViewProps`
 */
export type Shipped_PoolCard_TypeOf = View.Type<typeof PoolCard>;

/**
 * Long form we had been writing — equivalent to `PoolCard["Service"]`.
 * Hover: same as Shipped_PoolCard_Service
 */
export type Shipped_PoolCard_LongAnnotate = View.View<
  View.Type<typeof PoolCard>
>;

/** Defaults to ViewProps. Hover: `View.ViewProps` fn. */
export type Shipped_View_Default = View.View;

/** Statics on constructor. */
export type Shipped_PoolCard_size = (typeof PoolCard)["size"];
export type Shipped_PoolCard_key = (typeof PoolCard)["key"];

/** Instance metadata (ServiceClass.Shape) — hover for key / Service brands. */
export type Shipped_PoolCard_Instance = InstanceType<typeof PoolCard>;

export const shipped_poolSkin: PoolCard["Service"] = (props) => {
  void props.tag;
  void props.name;
  return null;
};

export const shipped_poolLayer = Layer.succeed(PoolCard, (props) => {
  void props.tag;
  return null;
});

// =============================================================================
// 3. Shipped View — Prototype with extra props
// =============================================================================

type DenseExtra = { readonly dense?: boolean };

export class DenseCard extends View.Card.Tag<DenseCard, DenseExtra>()(
  "hyperlink-ts/examples/forms/view/hover-types/DenseCard",
  { spec: { kind: "hover-dense" } as const },
) {}

/**
 * ★ Extra props — still no typeof.
 * Hover: `View.View<ViewProps & { dense?: boolean }>`
 */
export type Shipped_DenseCard_Service = DenseCard["Service"];

/** Peel props via {@link View.PropsOf} (Service path — no typeof). */
export type Shipped_DenseCard_Props = View.PropsOf<DenseCard>;

/** Phantom path (typeof). Hover: same props bag. */
export type Shipped_DenseCard_TypeOf = View.Type<typeof DenseCard>;

/** Open-chain Prototype still available for Requirement debt. */
const DenseOpen = View.SizeChrome.Prototype<DenseExtra>()({
  spec: { kind: "hover-dense-open" } as const,
});
export type Shipped_DenseOpen_PropsOf = View.PropsOf<typeof DenseOpen>;

export const shipped_denseSkin: DenseCard["Service"] = (props) => {
  void props.dense;
  void props.tag;
  return null;
};

export const shipped_denseLayer = Layer.succeed(DenseCard, (props) => {
  void props.dense;
  return null;
});

// =============================================================================
// 4. Shipped View — naked Tag + Detail / Page sizes
// =============================================================================

export class Greeter extends View.Tag<
  Greeter,
  { readonly name: string }
>()("hyperlink-ts/examples/forms/view/hover-types/Greeter") {}

/**
 * Naked Tag with Props type arg — no Prototype step.
 * Hover: `View.View<{ readonly name: string }>`
 */
export type Shipped_Greeter_Service = Greeter["Service"];

export class PoolDetail extends View.Detail.Tag<PoolDetail>()(
  "hyperlink-ts/examples/forms/view/hover-types/PoolDetail",
) {}

export type Shipped_PoolDetail_Service = PoolDetail["Service"];
export type Shipped_PoolDetail_size = (typeof PoolDetail)["size"];

export class PoolPage extends View.Page.Tag<PoolPage>()(
  "hyperlink-ts/examples/forms/view/hover-types/PoolPage",
) {}

export type Shipped_PoolPage_Service = PoolPage["Service"];
export type Shipped_PoolPage_size = (typeof PoolPage)["size"];

// =============================================================================
// 5. POC flat Card<Self, Props>() — compare hover to shipped §3
// =============================================================================

export type Poc_PoolCard_Service = Poc.PoolCard["Service"];
export type Poc_DenseCard_Service = Poc.DenseCard["Service"];
export type Poc_DenseCard_PropsOf = Poc.PropsOf<Poc.DenseCard>;
export type Poc_Greeter_Service = Poc.Greeter["Service"];
export type Poc_PoolCard_size = (typeof Poc.PoolCard)["size"];

export const poc_denseSkin: Poc.DenseCard["Service"] = Poc.denseSkin;

// =============================================================================
// 6. Side-by-side equality checks (hover + satisfies)
// =============================================================================

/** Shipped instance Service ≡ long View.Type form. */
export type Assert_Shipped_Service_eq_Long =
  Shipped_PoolCard_Service extends Shipped_PoolCard_LongAnnotate
    ? Shipped_PoolCard_LongAnnotate extends Shipped_PoolCard_Service
      ? true
      : false
    : false;

export const assert_shipped_service_eq_long =
  true satisfies Assert_Shipped_Service_eq_Long;

/** Shipped Dense props ≡ TypeOf phantom. */
export type Assert_Dense_Props_eq_TypeOf =
  Shipped_DenseCard_Props extends Shipped_DenseCard_TypeOf
    ? Shipped_DenseCard_TypeOf extends Shipped_DenseCard_Props
      ? true
      : false
    : false;

export const assert_dense_props_eq_typeof =
  true satisfies Assert_Dense_Props_eq_TypeOf;

// =============================================================================
// 7. Quick reference (read top → bottom; hover names on the right)
// =============================================================================

/**
 * Cheat sheet — hover each property:
 *
 * | Want | Prefer |
 * |------|--------|
 * | Component fn type | `PoolCard["Service"]` (escape hatch) |
 * | Props bag | `View.PropsOf<PoolCard>` / peel from Service |
 * | Provide skin | `View.provide(PoolCard, (props) => …)` / `PoolCard.provide(…)` |
 */
export type HoverCheatSheet = {
  effectShape: Effect_Config_InstanceService;
  shippedChromeFn: Shipped_PoolCard_Service;
  shippedDenseFn: Shipped_DenseCard_Service;
  shippedDenseProps: Shipped_DenseCard_Props;
  shippedLongForm: Shipped_PoolCard_LongAnnotate;
  pocDenseFn: Poc_DenseCard_Service;
  pocDenseProps: Poc_DenseCard_PropsOf;
};

export declare const hoverCheatSheet: HoverCheatSheet;

// Keep React import “used” for hover of ReactElement in View<>.
export type _ReactElement = React.ReactElement;
