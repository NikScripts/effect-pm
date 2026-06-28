/**
 * Resolve a public custom-queue level (number or configured name) to a lane index.
 *
 * @internal
 */
export const resolveCustomQueueLevel = (options: {
  readonly levelCount: number;
  readonly namedLevels: Readonly<Record<string, number>>;
  readonly defaultLevel: number;
  readonly input: number | string | undefined;
}): number => {
  const levelCount = Math.max(1, Math.floor(options.levelCount));
  const clamp = (level: number): number =>
    Math.min(levelCount - 1, Math.max(0, Math.floor(level)));

  if (options.input === undefined) {
    return clamp(options.defaultLevel);
  }
  if (typeof options.input === "number") {
    return clamp(options.input);
  }
  const named = options.namedLevels[options.input];
  if (named !== undefined) {
    return clamp(named);
  }
  const parsed = Number(options.input);
  if (!Number.isNaN(parsed)) {
    return clamp(parsed);
  }
  return clamp(options.defaultLevel);
};
