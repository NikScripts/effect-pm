/**
 * Makes a widget from an id.
 *
 * @category constructors
 * @since 1.0.0
 */
export const makeWidget = (id: number): Widget => ({ id });

export interface Widget {
  readonly id: number;
}

/**
 * The answer.
 *
 * @since 1.0.0
 */
export const answer = 42;

/**
 * Doubles a number or repeats a string.
 *
 * @since 1.0.0
 */
export function twice(value: number): number;
export function twice(value: string): string;
export function twice(value: number | string): number | string {
  return typeof value === "number" ? value * 2 : `${value}${value}`;
}
