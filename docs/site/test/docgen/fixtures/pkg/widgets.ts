/**
 * A widget.
 *
 * @category models
 * @since 1.0.0
 */
export interface Widget {
  readonly id: number;
}

/**
 * Makes a widget — see {@link Widget}.
 *
 * @category constructors
 * @since 1.0.0
 */
export const makeWidget = (id: number): Widget => ({ id });
