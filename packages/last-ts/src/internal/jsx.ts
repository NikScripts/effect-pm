/**
 * Typed JSX spine — `Element<R>` brand + child/type `R` collectors.
 *
 * Used by `jsx-runtime` / `jsx-dev-runtime`. Apps import types via `last-ts/Jsx`.
 *
 * @internal
 */
import type * as React from "react";

declare const elementServicesSym: unique symbol;

/**
 * Phantom prop key for services `R` stamped on a View-like component fn.
 *
 * @internal
 */
export type ViewServicesKey = "~last-ts/View/services";

/**
 * React element that carries a type-level services bag `R` (usually Context tags).
 *
 * Runtime value is a normal React element; `R` is erased at runtime.
 *
 * @internal
 */
export type Element<R = never> = React.ReactElement & {
  readonly [elementServicesSym]: R;
};

/**
 * Component fn carrying services `R` (render still returns a plain React element).
 *
 * @internal
 */
export type ViewFn<Props extends object = {}, R = never> = ((
  props: Props,
) => React.ReactElement | null) & {
  readonly "~last-ts/View/services": R;
};

/**
 * `R` stamped on a view-like component (preferred over return-type inference).
 *
 * @internal
 */
export type ServicesOfViewFn<T> = T extends {
  readonly "~last-ts/View/services": infer R;
}
  ? R
  : never;

/**
 * `true` when `T` is `any` (do not use `T extends any` — that distributes).
 *
 * @internal
 */
export type IsAny<T> = 0 extends 1 & T ? true : false;

/**
 * Services carried by an {@link Element} (or `never` when not an Element).
 * `any` → `never` so JSX syntax black-box / error types do not poison `R`.
 *
 * @internal
 */
export type ServicesOfElement<E> = IsAny<E> extends true
  ? never
  : E extends Element<infer R>
    ? IsAny<R> extends true
      ? never
      : R
    : never;

/**
 * Fold `R` out of a JSX `children` value (element, array, or ReactNode mix).
 *
 * @internal
 */
export type ServicesOfChildren<C> = C extends Element<infer R>
  ? R
  : C extends readonly (infer U)[]
    ? ServicesOfChildren<U>
    : never;

/**
 * `R` contributed by a props bag’s `children` (if any).
 *
 * @internal
 */
export type ServicesOfPropsChildren<P> = P extends {
  readonly children?: infer C;
}
  ? ServicesOfChildren<C>
  : never;

/**
 * `R` from a tag type: prefer stamped view services, else return `Element<R>`.
 * Host tags → `never`.
 *
 * @internal
 */
export type ServicesOfType<T> = [ServicesOfViewFn<T>] extends [never]
  ? T extends (...args: any) => infer Ret
    ? ServicesOfElement<Exclude<Ret, null | undefined>>
    : never
  : ServicesOfViewFn<T>;

/**
 * Merged `R` for a `jsx(type, props)` call.
 *
 * @internal
 */
export type ServicesOfJsx<T, P> = ServicesOfType<T> | ServicesOfPropsChildren<P>;
