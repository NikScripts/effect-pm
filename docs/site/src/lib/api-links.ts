// Resolve an API type name (as it appears in a twoslash type preview) to its doc-page URL.
// Built from the generated API model. Qualified names (Namespace.export) are unique; a bare export
// name is only linkable when it's unambiguous (belongs to exactly one symbol), so we never guess.

import { namespaces } from "./api.js";

const qualified = new Map<string, string>(); // "QueueResource.Tag" -> "/api/QueueResource/Tag"
const bare = new Map<string, string>(); // "QueueNodeBoundTag" -> url, only when unambiguous
{
  const count = new Map<string, number>();
  const firstUrl = new Map<string, string>();
  for (const ns of namespaces()) {
    for (const s of ns.symbols) {
      qualified.set(s.qualifiedName, s.url);
      count.set(s.name, (count.get(s.name) ?? 0) + 1);
      if (!firstUrl.has(s.name)) firstUrl.set(s.name, s.url);
    }
  }
  for (const [name, url] of firstUrl) {
    if (count.get(name) === 1) bare.set(name, url);
  }
}

/**
 * URL for an API type name — qualified first (`Namespace.export`), then the bare export name (only
 * if unambiguous, and only when `allowBare`). undefined when nothing matches (e.g. an `effect` type).
 * `allowBare` is false when the token is itself a namespace qualifier (followed by `.`), so an
 * external namespace like `Schema` in `Schema.Struct` never matches an unrelated same-named export.
 */
export const resolveApiLink = (
  qualifiedName: string | undefined,
  name: string,
  allowBare: boolean,
): string | undefined =>
  (qualifiedName !== undefined ? qualified.get(qualifiedName) : undefined) ??
  (allowBare ? bare.get(name) : undefined);
