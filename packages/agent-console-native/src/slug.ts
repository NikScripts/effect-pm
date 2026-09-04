/**
 * Adjective-noun name generator for auto-named worktrees, mirroring the
 * style of OpenCode's own session `slug` field (e.g. "playful-squid").
 * Ported from packages/agent-console/src/opencode/slug.ts.
 *
 * @internal
 */
const ADJECTIVES = [
  "playful",
  "quiet",
  "brisk",
  "amber",
  "cosmic",
  "gentle",
  "lucky",
  "misty",
  "nimble",
  "solar",
  "vivid",
  "wandering",
  "cobalt",
  "dusty",
  "electric",
] as const;

const NOUNS = [
  "squid",
  "otter",
  "falcon",
  "meadow",
  "ridge",
  "harbor",
  "comet",
  "lantern",
  "pebble",
  "willow",
  "canyon",
  "sparrow",
  "glacier",
  "ember",
  "thicket",
] as const;

export const randomSlug = (): string => {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]!;
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]!;
  return `${adjective}-${noun}`;
};
