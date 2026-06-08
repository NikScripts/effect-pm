/**
 * Stable identity for the {@link RunResource} facet — `TypeTag` / `TypeId`
 * shared by the worker kernel, telemetry Tag, and archive facet without any
 * of them depending on each other.
 *
 * @module RunResourceIdentity
 */

/** Canonical string identity for `RunResource`. @public */
export const TypeTag = "@nikscripts/effect-pm/RunResource";

/** Unique symbol identity for `RunResource`. @public */
export const TypeId: unique symbol = Symbol.for(TypeTag);

/** @public */
export type TypeId = typeof TypeId;
