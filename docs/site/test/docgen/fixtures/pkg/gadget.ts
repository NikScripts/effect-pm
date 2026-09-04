/**
 * Makes a gadget.
 *
 * @since 1.0.0
 */
export const makeGadget = (): string => "gadget";

/**
 * Spins a gadget; exported publicly as `spin`.
 *
 * @since 1.0.0
 */
export const internalSpin = (turns: number): number => turns * 2;

/**
 * Sums the {@link parts}; see also {@link makeGadget}.
 *
 * @since 1.0.0
 */
export const assemble = (parts: ReadonlyArray<string>): string => parts.join("+");
