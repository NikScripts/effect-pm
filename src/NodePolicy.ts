/**
 * NodePolicy — this process vs its address list (primary set, listen, advertise, proxy, as).
 *
 * Built on {@link PolicyBuilder}: private plural constructable `NodePolicies`
 * declares Schema keys / PascalCase References and camelCase Layer methods
 * (`Uncapitalize` — `"Listen"` → `listen`). This singular module re-exports
 * those. Apps import this namespace — not the builder.
 *
 * Owned mode strings are PascalCase (`"All"`, `"Primary"`, `"AllUnlabeled"`,
 * `"Prefer"`). App labels (`"A"` / `"B"`) keep the app’s spelling.
 *
 * Pairs with `Node`. Sister module: {@link LookupPolicy} (Lookup / Directory
 * participation). Dial / sticky / verify stay on LookupPolicy — not here.
 *
 * ```ts
 * import * as NodePolicy from "hyperlink-ts/NodePolicy"
 *
 * NodePolicy.primaryAddress("AllUnlabeled") // default — primary set = unlabeled
 * NodePolicy.listen("All")
 * NodePolicy.advertise("Primary")           // publish the PrimaryAddress set
 * NodePolicy.proxy("Prefer")                // primary forwards → Active label
 * NodePolicy.active("A")                    // Prefer target (flip via Node.activate)
 * NodePolicy.as("A")                        // this OS process is the "A" side
 *
 * NodePolicy.make({
 *   PrimaryAddress: "AllUnlabeled",
 *   Listen: "All",
 *   Advertise: "Primary",
 *   Proxy: "Prefer",
 *   Active: "A",
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
 * How the primary address set is defined.
 *
 * - `"AllUnlabeled"` — every unlabeled address (several same-protocol OK; list, not last-wins)
 * - `"All"` — every declared address is primary
 * - label list — explicit primary set
 *
 * @category schemas
 * @public
 */
export const primaryAddressSchema = Schema.Union([
  Schema.Literals(["AllUnlabeled", "All"]),
  Schema.Array(Schema.String),
]);

/**
 * Address-list selection — all declared, the primary set, or an explicit label list.
 *
 * `"Primary"` means the set from {@link PrimaryAddress} (not “unlabeled” by itself).
 *
 * @category schemas
 * @public
 */
export const addressSelectionSchema = Schema.Union([
  Schema.Literals(["All", "Primary"]),
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
 * Primary forwards to the live labeled side ({@link Active} / {@link Node.activate}).
 *
 * @category schemas
 * @public
 */
export const proxySchema = Schema.Literal("Prefer");

/**
 * This OS process **is** labeled side `"A"` / `"B"` (not a vague “role”).
 *
 * @category schemas
 * @public
 */
export const asSchema = Schema.String;

/**
 * Which labeled backend {@link NodePolicy.Proxy} Prefer currently dials.
 * Flip at runtime with {@link Node.activate} (seeded from this stamp).
 *
 * @category schemas
 * @public
 */
export const activeSchema = Schema.String;

// =============================================================================
// Models
// =============================================================================

/**
 * Primary-set definition.
 *
 * @category models
 * @public
 */
export type PrimaryAddress = Schema.Schema.Type<typeof primaryAddressSchema>;

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
 * Live Prefer target label (`"A"` / `"B"` / …).
 *
 * @category models
 * @public
 */
export type Active = Schema.Schema.Type<typeof activeSchema>;

/**
 * Product bag for {@link make} / stamped {@link config}.
 *
 * @category models
 * @public
 */
export type Config = {
  readonly PrimaryAddress?: PrimaryAddress;
  readonly Listen?: Listen;
  readonly Advertise?: Advertise;
  readonly Proxy?: Proxy;
  readonly Active?: Active;
  readonly As?: As;
};

/**
 * Tagged override entry — `_tag` is the knob name.
 *
 * @category models
 * @public
 */
export type Fragment =
  | { readonly _tag: "PrimaryAddress"; readonly value: PrimaryAddress }
  | { readonly _tag: "Listen"; readonly value: Listen }
  | { readonly _tag: "Advertise"; readonly value: Advertise }
  | { readonly _tag: "Proxy"; readonly value: Proxy }
  | { readonly _tag: "Active"; readonly value: Active }
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
 * Defaults: primary set = all unlabeled; listen all; advertise primary set;
 * no proxy; no as.
 */
class NodePolicies extends PolicyBuilder.make(builderId)
  .key("PrimaryAddress", primaryAddressSchema, {
    defaultValue: (): PrimaryAddress => "AllUnlabeled",
  })
  .key("Listen", listenSchema, {
    defaultValue: (): Listen => "All",
  })
  .key("Advertise", advertiseSchema, {
    defaultValue: (): Advertise => "Primary",
  })
  .key("Proxy", Schema.Union([proxySchema, Schema.Undefined]), {
    defaultValue: (): Proxy | undefined => undefined,
  })
  .key("Active", Schema.Union([activeSchema, Schema.Undefined]), {
    defaultValue: (): Active | undefined => undefined,
  })
  .key("As", Schema.Union([asSchema, Schema.Undefined]), {
    defaultValue: (): As | undefined => undefined,
  }) {}

// =============================================================================
// References (PascalCase — Context.Reference)
// =============================================================================

/**
 * How the primary address set is defined. Default `"AllUnlabeled"`.
 *
 * @category references
 * @public
 */
export const PrimaryAddress = NodePolicies.PrimaryAddress;

/**
 * Which declared addresses this process binds. Default `"All"`.
 *
 * @category references
 * @public
 */
export const Listen = NodePolicies.Listen;

/**
 * Which addresses Directory publishes. Default `"Primary"` (the
 * {@link PrimaryAddress} set).
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
 * Live Prefer target label. Default unset (forward seeds first labeled address).
 *
 * @category references
 * @public
 */
export const Active = NodePolicies.Active;

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

/** Define the primary address set. @category layers @public */
export const primaryAddress = NodePolicies.primaryAddress;

/** Bind selection. @category layers @public */
export const listen = NodePolicies.listen;

/** Directory publish selection. @category layers @public */
export const advertise = NodePolicies.advertise;

/** Primary forwards to live labeled side. @category layers @public */
export const proxy = NodePolicies.proxy;

/** Seed / stamp the Prefer target label. @category layers @public */
export const active = NodePolicies.active;

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
