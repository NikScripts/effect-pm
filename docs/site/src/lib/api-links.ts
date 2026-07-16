// Resolve an API type name (as it appears in a twoslash type preview) to its doc-page URL.
// The maps are populated from the split link index via loadApiLinks() (run before rendering, like
// loadHighlighter) — the read goes through effect/FileSystem, not node:fs — and resolution stays a
// plain sync lookup for the (sync) shiki/twoslash pipeline. Qualified names are unique; a bare export
// name is only linkable when it belongs to exactly one symbol, so we never guess.

import { linkSymbols } from "./api-data.js";
import { runServer } from "./runtime.js";

const qualified = new Map<string, string>(); // "QueueResource.Tag" -> its doc URL
const bare = new Map<string, string>(); // "QueueNodeBoundTag" -> url, only when unambiguous
let loaded = false;

/** Populate the resolver maps from the link index (idempotent). Await before rendering. */
export const loadApiLinks = async (): Promise<void> => {
  if (loaded) return;
  const symbols = await runServer(linkSymbols());
  const count = new Map<string, number>();
  const firstUrl = new Map<string, string>();
  for (const s of symbols) {
    qualified.set(s.qualifiedName, s.url);
    count.set(s.name, (count.get(s.name) ?? 0) + 1);
    if (!firstUrl.has(s.name)) firstUrl.set(s.name, s.url);
  }
  for (const [name, url] of firstUrl) {
    if (count.get(name) === 1) bare.set(name, url);
  }
  loaded = true;
};

/**
 * URL for an API type name — qualified first (`Namespace.export`), then the bare export name (only
 * if unambiguous, and only when `allowBare`). undefined when nothing matches (e.g. an `effect` type
 * that isn't documented). `allowBare` is false when the token is itself a namespace qualifier
 * (followed by `.`), so an external namespace like `Schema` in `Schema.Struct` never matches an
 * unrelated same-named export.
 */
export const resolveApiLink = (
  qualifiedName: string | undefined,
  name: string,
  allowBare: boolean,
): string | undefined =>
  (qualifiedName !== undefined ? qualified.get(qualifiedName) : undefined) ??
  (allowBare ? bare.get(name) : undefined);
