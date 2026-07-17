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
