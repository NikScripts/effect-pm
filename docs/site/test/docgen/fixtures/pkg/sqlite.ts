/**
 * Opens the sqlite store.
 *
 * @since 1.0.0
 */
export const open = (path: string): string => `sqlite:${path}`;
