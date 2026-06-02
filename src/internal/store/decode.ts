/**
 * Small decode combinators for facet-owned `RuntimeRecord` projections.
 *
 * @internal
 */

import { Option } from "effect";
import { isFiniteNumber, isRecord, isString } from "../json";

/** @internal */
export const nullable = <A>(option: Option.Option<A>): A | null =>
  option.pipe(
    Option.match({
      onNone: () => null,
      onSome: (value) => value,
    }),
  );

/** @internal */
export const optionFromNullable = <A>(value: A | null): Option.Option<A> =>
  value === null ? Option.none<A>() : Option.some(value);

/** @internal */
export const valueWhen = <A>(
  value: unknown,
  guard: (value: unknown) => value is A,
): Option.Option<A> => guard(value) ? Option.some(value) : Option.none();

/** @internal */
export const optionalValue = <A>(
  value: unknown,
  guard: (value: unknown) => value is A,
): Option.Option<A | undefined> =>
  value === undefined || value === "undefined"
    ? Option.some(undefined)
    : valueWhen(value, guard);

/** @internal */
export const stringValue = (value: unknown): Option.Option<string> =>
  valueWhen(value, isString);

/** @internal */
export const numberValue = (value: unknown): Option.Option<number> =>
  valueWhen(value, isFiniteNumber);

/** @internal */
export const recordValue = (
  value: unknown,
): Option.Option<Readonly<Record<string, unknown>>> =>
  valueWhen(value, isRecord);

/** @internal */
export const filterMapNullable = <A, B>(
  values: Iterable<A>,
  f: (value: A) => B | null,
): B[] =>
  Array.from(values).flatMap((value) =>
    Option.toArray(optionFromNullable(f(value))),
  );
