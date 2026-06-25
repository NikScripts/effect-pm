/**
 * @module web/cn
 * Minimal class-name joiner (no clsx/tailwind-merge dependency).
 * @since 1.0.0
 */
export type ClassValue = string | false | null | undefined;

/** Join truthy class strings. @since 1.0.0 */
export const cn = (...inputs: ReadonlyArray<ClassValue>): string =>
  inputs.filter((c): c is string => typeof c === "string" && c.length > 0).join(" ");
