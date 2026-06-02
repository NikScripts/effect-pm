/** Utility for joining shadcn-style class names. */
export const cn = (
  ...classes: ReadonlyArray<string | false | null | undefined>
): string => classes.filter((item): item is string => typeof item === "string" && item.length > 0).join(" ");
