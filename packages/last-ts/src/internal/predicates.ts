/**
 * Cast-free runtime probes — narrow by *checking*, never by asserting.
 *
 * `getProp` reads any own-or-inherited property as `unknown` (`Reflect.get` walks the
 * prototype chain, so brands declared as statics on a factory base class are visible on
 * subclasses). The `*OrUndefined` readers validate loose prop records field by field.
 *
 * @internal
 */

/** Own-or-inherited property read as `unknown`; non-objects read as `undefined`. @internal */
export const getProp = (u: unknown, key: PropertyKey): unknown =>
  (typeof u === "object" || typeof u === "function") && u !== null
    ? Reflect.get(u, key)
    : undefined;

/** Brand probe — the property stored under `brand` holds the brand value itself. @internal */
export const hasBrand = (u: unknown, brand: string): boolean =>
  getProp(u, brand) === brand;

/** @internal */
export const stringOrUndefined = (u: unknown): string | undefined =>
  typeof u === "string" ? u : undefined;

/** @internal */
export const booleanOrUndefined = (u: unknown): boolean | undefined =>
  typeof u === "boolean" ? u : undefined;
