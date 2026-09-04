// Process-lifetime bags that survive Vite SSR module re-evaluation during Waku SSG.
// Module-scoped `let`s reset when the bundler reloads the module per page; Shiki then
// allocates a new highlighter hundreds of times and OOMs the build. Slot state on
// `globalThis` instead.

const ROOT = "__hyperlinkDocsProcess" as const;

type Root = Record<string, object | undefined>;

const root = (): Root => {
  const g = globalThis as typeof globalThis & { [ROOT]?: Root };
  if (g[ROOT] === undefined) g[ROOT] = {};
  return g[ROOT];
};

/** Return the process bag for `key`, creating it with `init` on first access. */
export const processSlot = <T extends object>(key: string, init: () => T): T => {
  const bag = root();
  const existing = bag[key];
  if (existing !== undefined) {
    // Same key always stores the same T; the bag is untyped so the root can hold many slots.
    return existing as T;
  }
  const created = init();
  bag[key] = created;
  return created;
};
