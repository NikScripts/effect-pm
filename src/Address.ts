/**
 * Address — dial construction for {@link Node.make} address lists.
 *
 * Unlabeled (`label: undefined`) is **not** primary by itself — the primary set
 * is defined by {@link NodePolicy.primaryAddress} (default `"AllUnlabeled"`).
 * Several unlabeled addresses of the same protocol are all kept (list, not
 * last-wins). Same concrete dial twice is rejected.
 *
 * ```ts
 * import * as Address from "hyperlink-ts/Address"
 * import * as Node from "hyperlink-ts/Node"
 *
 * Address.http(":8080")
 * Address.unix("A", "/var/run/w.a.sock")
 * Address.ws([4000, 4001])
 * Address.http({ A: 3000, B: 3001 })
 * Address.unixFromKey // sentinel — no ()
 *
 * class Worker extends Node.make("fleet/Worker", Address.http(":8080")).pipe(
 *   Address.unix("A", "/var/run/w.a.sock"),
 * ) {}
 * ```
 *
 * @module Address
 */
import type { ProtocolKind } from "./internal/nodeCore";
import * as internal from "./internal/address";

// =============================================================================
// Models
// =============================================================================

/**
 * Key-derived Unix dial sentinel (`Address.unixFromKey` — no `()`).
 *
 * @category models
 * @public
 */
export type UnixFromKey = internal.UnixFromKeySentinel;

/**
 * One address value — optional label; unlabeled when `label` is `undefined`.
 *
 * @category models
 * @public
 */
export type Address<
  Label extends string | undefined = undefined,
  Kind extends ProtocolKind = ProtocolKind,
> = internal.AddressValue<Label, Kind>;

/**
 * Any address (value or {@link UnixFromKey} sentinel).
 *
 * @category models
 * @public
 */
export type Any = internal.AnyAddress;

/**
 * Dial payload on an {@link Address}.
 *
 * @category models
 * @public
 */
export type Dial = internal.AddressDial;

/**
 * Labeled sides only from an address list (`undefined` labels dropped).
 *
 * @category models
 * @public
 */
export type LabelsOf<As extends ReadonlyArray<Any>> = internal.LabelsOf<As>;

/**
 * Normalize a make/pipe input to a readonly address list.
 *
 * @category models
 * @public
 */
export type Normalize<A> = internal.NormalizeAddresses<A>;

// =============================================================================
// Errors
// =============================================================================

/**
 * Two addresses resolve to the same concrete dial.
 *
 * @category errors
 * @public
 */
export const DialOverlap = internal.AddressDialOverlap;

export type DialOverlap = internal.AddressDialOverlap;

// =============================================================================
// Constructors
// =============================================================================

/**
 * Http address(es) — scalar primary, array of unlabeled, or labeled object.
 *
 * @category constructors
 * @public
 */
export const http: typeof internal.http = internal.http;

/**
 * WebSocket address(es) — scalar, array, or labeled object.
 *
 * @category constructors
 * @public
 */
export const ws: typeof internal.ws = internal.ws;

/**
 * Unix address — `unix(path)` unlabeled, or `unix(label, path)` labeled.
 *
 * @category constructors
 * @public
 */
export const unix: typeof internal.unix = internal.unix;

/**
 * Key-derived Unix dial sentinel — write `Address.unixFromKey` (no `()`).
 *
 * @category constructors
 * @public
 */
export const unixFromKey: UnixFromKey = internal.unixFromKey;

// =============================================================================
// Guards / utils
// =============================================================================

/**
 * Type guard for {@link unixFromKey}.
 *
 * @category guards
 * @public
 */
export const isUnixFromKey: typeof internal.isUnixFromKey =
  internal.isUnixFromKey;

/**
 * Type guard for an {@link Address} value (not the unixFromKey sentinel).
 *
 * @category guards
 * @public
 */
export const isAddress: typeof internal.isAddressValue = internal.isAddressValue;

/**
 * Stable dial identity string (overlap checks).
 *
 * @category utils
 * @public
 */
export const dialIdentity: typeof internal.dialIdentity = internal.dialIdentity;

/**
 * Throw {@link DialOverlap} when two addresses share a concrete dial.
 *
 * @category utils
 * @public
 */
export const assertNoDialOverlap: typeof internal.assertNoDialOverlap =
  internal.assertNoDialOverlap;
