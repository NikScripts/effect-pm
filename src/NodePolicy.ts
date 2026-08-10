/**
 * NodePolicy — this process vs its address list (listen, advertise, proxy, as).
 *
 * Built on {@link PolicyBuilder}: private plural constructable `NodePolicies`
 * declares Schema keys / PascalCase References and camelCase Layer methods
 * (`Uncapitalize` — `"Listen"` → `listen`). This singular module re-exports
 * those. Apps import this namespace — not the builder.
 *
 * Pairs with `Node`. Sister module: {@link LookupPolicy} (Lookup / Directory
 * participation). Dial / sticky / verify stay on LookupPolicy — not here.
 *
 * ```ts
 * import * as NodePolicy from "hyperlink-ts/NodePolicy"
 *
 * NodePolicy.listen("all")
 * NodePolicy.advertise("primary")
 * NodePolicy.proxy("prefer")
 * NodePolicy.as("A")
 *
 * NodePolicy.make({
 *   Listen: "all",
 *   Advertise: "primary",
 *   Proxy: "prefer",
 *   As: "A",
 * })
 * ```
 *
 * @module NodePolicy
 */
import { Layer, Schema } from "effect";
import * as PolicyBuilder from "./PolicyBuilder";

/** Brand id + Context.Reference prefix (`${id}/Listen`, …). */
const builderId = "hyperlink-ts/NodePolicy" as const;

// =============================================================================
// Schemas
// =============================================================================

/**
 * Address-list selection — all declared, primaries only, or an explicit label list.
 *
 * @category schemas
 * @public
 */
export const addressSelectionSchema = Schema.Union([
  Schema.Literal("all"),
  Schema.Literal("primary"),
  Schema.Array(Schema.String),
]);

/**
 * Which declared addresses this process binds.
 *
 * @category schemas
 * @public
 */
export const listenSchema = addressSelectionSchema;

/**
 * Which addresses land in Directory (what clients can discover).
 *
 * @category schemas
 * @public
 */
export const advertiseSchema = addressSelectionSchema;

/**
 * Primary forwards to the live labeled side (e.g. Advice prefer).
 *
 * @category schemas
 * @public
 */
export const proxySchema = Schema.Literal("prefer");

/**
 * This OS process **is** labeled side `"A"` / `"B"` (not a vague “role”).
 *
 * @category schemas
 * @public
 */
export const asSchema = Schema.String;

// =============================================================================
// Models
// =============================================================================

/**
 * Address-list selection value.
 *
 * @category models
 * @public
 */
export type AddressSelection = Schema.Schema.Type<typeof addressSelectionSchema>;

/**
 * Listen selection — which declared addresses this process binds.
 *
 * @category models
 * @public
 */
export type Listen = Schema.Schema.Type<typeof listenSchema>;

/**
 * Advertise selection — which addresses Directory publishes.
 *
 * @category models
 * @public
 */
export type Advertise = Schema.Schema.Type<typeof advertiseSchema>;

/**
 * Proxy mode — primary forwards to the live labeled side.
 *
 * @category models
 * @public
 */
export type Proxy = Schema.Schema.Type<typeof proxySchema>;

/**
 * Labeled address side this OS process is (`"A"` / `"B"` / …).
 *
 * @category models
 * @public
 */
export type As = Schema.Schema.Type<typeof asSchema>;

/**
 * Product bag for {@link make} / stamped {@link config}.
 *
 * @category models
 * @public
 */
export type Config = {
  readonly Listen?: Listen;
  readonly Advertise?: Advertise;
  readonly Proxy?: Proxy;
  readonly As?: As;
};

/**
 * Tagged override entry — `_tag` is the knob name.
 *
 * @category models
 * @public
 */
export type Fragment =
  | { readonly _tag: "Listen"; readonly value: Listen }
  | { readonly _tag: "Advertise"; readonly value: Advertise }
  | { readonly _tag: "Proxy"; readonly value: Proxy }
  | { readonly _tag: "As"; readonly value: As };

/**
 * Patch `Prev` with `Patch` — patch keys win.
 *
 * @category models
 * @public
 */
export type MergeConfigs<
  Prev extends Config,
  Patch extends Config,
> = PolicyBuilder.MergeConfigs<Prev, Patch>;

/**
 * A branded NodePolicy fragment / bundle (`Layer.Layer<never>` + frozen config).
 *
 * @category models
 * @public
 */
export type Policy<C extends Config = Config> = PolicyBuilder.Policy<
  typeof builderId,
  C
>;

/**
 * Config type parameter of a {@link Policy}.
 *
 * @category models
 * @public
 */
export type ConfigOf<P> = PolicyBuilder.ConfigOf<P>;

/**
 * Left-to-right {@link MergeConfigs} over a list of {@link Policy} values.
 *
 * @category models
 * @public
 */
export type MergePolicyList<Ps extends ReadonlyArray<Policy<Config>>> =
  PolicyBuilder.MergePolicyList<typeof builderId, Ps>;

// =============================================================================
// NodePolicies (private constructable — module re-exports below)
// =============================================================================

/**
 * Private plural constructable. Singular module namespace is `NodePolicy`.
 *
 * Defaults (candidate lock): listen all; advertise primaries; no proxy; no as.
 */
class NodePolicies extends PolicyBuilder.make(builderId)
  .key("Listen", listenSchema, {
    defaultValue: (): Listen => "all",
  })
  .key("Advertise", advertiseSchema, {
    defaultValue: (): Advertise => "primary",
  })
  .key("Proxy", Schema.Union([proxySchema, Schema.Undefined]), {
    defaultValue: (): Proxy | undefined => undefined,
  })
  .key("As", Schema.Union([asSchema, Schema.Undefined]), {
    defaultValue: (): As | undefined => undefined,
  }) {}

// =============================================================================
// References (PascalCase — Context.Reference)
// =============================================================================

/**
 * Which declared addresses this process binds. Default `"all"`.
 *
 * @category references
 * @public
 */
export const Listen = NodePolicies.Listen;

/**
 * Which addresses Directory publishes. Default `"primary"`.
 *
 * @category references
 * @public
 */
export const Advertise = NodePolicies.Advertise;

/**
 * Primary → live labeled forward mode. Default unset (no proxy).
 *
 * @category references
 * @public
 */
export const Proxy = NodePolicies.Proxy;

/**
 * Labeled side this OS process is. Default unset.
 *
 * @category references
 * @public
 */
export const As = NodePolicies.As;

// =============================================================================
// Layer helpers (camelCase — Uncapitalize of PascalCase key / `_tag`)
// =============================================================================

/** Bind selection. @category layers @public */
export const listen = NodePolicies.listen;

/** Directory publish selection. @category layers @public */
export const advertise = NodePolicies.advertise;

/** Primary forwards to live labeled side. @category layers @public */
export const proxy = NodePolicies.proxy;

/** This process is labeled side `label`. @category layers @public */
export const as = NodePolicies.as;

// =============================================================================
// Fragment matchers / bag converters
// =============================================================================

/**
 * Type guard for a tagged {@link Fragment} by `_tag`.
 *
 * @category guards
 * @public
 */
export const isFragment = NodePolicies.isFragment;

/**
 * Exhaustive match over a {@link Fragment} (dual).
 *
 * @category utils
 * @public
 */
export const matchFragment = NodePolicies.matchFragment;

/**
 * Product {@link Config} → {@link Fragment} list (present keys only).
 *
 * @category constructors
 * @public
 */
export const fromConfig = NodePolicies.fromConfig.bind(NodePolicies);

/**
 * {@link Fragment} list → product bag (last write wins).
 *
 * @category constructors
 * @public
 */
export const toConfig = NodePolicies.toConfig.bind(NodePolicies);

// =============================================================================
// layer / make / provide / guards
// =============================================================================

/**
 * Type guard for {@link Policy} values.
 *
 * @category guards
 * @public
 */
export const isPolicy = (u: unknown): u is Policy<Config> => NodePolicies.is(u);

/**
 * Read the runtime config stamped on a {@link Policy}.
 *
 * @category getters
 * @public
 */
export const config = <C extends Config>(self: Policy<C>): C =>
  NodePolicies.config(self);

/**
 * Merge NodePolicy Layers (last write wins) **and** expand configs.
 *
 * @category layers
 * @public
 */
export const layer: typeof NodePolicies.layer = NodePolicies.layer;

/**
 * One tagged {@link Fragment} → branded single-key {@link Policy}.
 *
 * @category constructors
 * @public
 */
export const succeed: typeof NodePolicies.succeed =
  NodePolicies.succeed.bind(NodePolicies);

/**
 * Build a {@link Policy} from a product {@link Config} bag **or** a
 * {@link Fragment} list.
 *
 * @category constructors
 * @public
 */
export const make: {
  <const C extends Config>(config: C): Policy<C>;
  <const Fs extends ReadonlyArray<Fragment>>(
    fragments: Fs,
  ): Policy<PolicyBuilder.ConfigFromFragments<Fs>>;
} = NodePolicies.make.bind(NodePolicies);

/**
 * Provide NodePolicy Layers onto a Layer.
 *
 * @category layers
 * @public
 */
export const provide =
  (...policies: ReadonlyArray<Layer.Layer<never>>) =>
  <A, E, R>(self: Layer.Layer<A, E, R>): Layer.Layer<A, E, R> =>
    NodePolicies.provide(...policies)(self);
