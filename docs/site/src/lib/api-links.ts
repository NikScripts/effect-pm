// Resolve an API type name (as it appears in a twoslash type preview or a doc comment) to its
// doc-page URL. The map is populated from the split link index via loadApiLinks() (run before
// rendering, like loadHighlighter) — the read goes through effect/FileSystem, not node:fs — and
// resolution stays a plain sync lookup for the (sync) shiki/twoslash pipeline.
//
// A term is linkable ONLY when it is globally unambiguous, computed by one bucket: each export drops
// in its qualified name (`Resource.Tag`) AND, when different, its bare name (`Tag`). A term links iff
// it occurs exactly once across that bucket. So given `Resource.Tag` + `Process.Tag`, both qualified
// names link but the shared bare `Tag` (2 occurrences) does not; given a lone `Resource.Tag`, both
// `Resource.Tag` and `Tag` link. We never guess between collisions.

import { linkSymbols } from "./api-data.js";
import { runServer } from "./runtime.js";

const link = new Map<string, string>(); // unambiguous term ("Resource.Tag" | "Tag") -> its doc URL
let loaded = false;

/** Populate the resolver map from the link index (idempotent). Await before rendering. */
export const loadApiLinks = async (): Promise<void> => {
  if (loaded) return;
  const symbols = await runServer(linkSymbols());
  // Bucket every candidate term with its occurrence count and first URL; keep only the singletons.
  const count = new Map<string, number>();
  const urlOf = new Map<string, string>();
  const add = (term: string, url: string): void => {
    count.set(term, (count.get(term) ?? 0) + 1);
    if (!urlOf.has(term)) urlOf.set(term, url);
  };
  for (const s of symbols) {
    add(s.qualifiedName, s.url);
    if (s.name !== s.qualifiedName) add(s.name, s.url);
  }
  for (const [term, n] of count) {
    const url = urlOf.get(term);
    if (n === 1 && url !== undefined) link.set(term, url);
  }
  loaded = true;
};

/**
 * URL for an API type name — the qualified form (`Namespace.export`) first, then the bare export name
 * (only when `allowBare`). Both consult the same unambiguous-term map, so a term that collided with
 * another export never resolves. undefined when nothing matches (e.g. an `effect` type that isn't
 * documented). `allowBare` is false when the token is itself a namespace qualifier (followed by `.`),
 * so an external namespace like `Schema` in `Schema.Struct` never matches an unrelated same-named
 * export.
 */
export const resolveApiLink = (
  qualifiedName: string | undefined,
  name: string,
  allowBare: boolean,
): string | undefined =>
  (qualifiedName !== undefined ? link.get(qualifiedName) : undefined) ??
  (allowBare ? link.get(name) : undefined);
