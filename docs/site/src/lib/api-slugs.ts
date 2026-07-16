// Shared URL-slug / data-file-key helpers for the API reference. Pure string transforms with no deps,
// so gen-api.ts (writer), gen-hovers.ts, and src/lib/api-data.ts (reader) all use ONE copy — a drift
// between them would break sidecar paths and produce 404s.

// A namespace entry -> its URL slug. `(top-level)` -> `top-level`; `storage/sqlite` -> `storage-sqlite`.
export const slugForEntry = (entry: string): string =>
  entry === "(top-level)" ? "top-level" : entry.replace(/\//g, "-");

// An export name -> its on-disk data-file key. Names can differ only by case (a type `Foo` and a value
// `foo` in one module); on a case-insensitive filesystem `Foo.json` and `foo.json` are the SAME file,
// so one clobbers the other. Lowercase the name + append the uppercase-letter positions (joined by `-`,
// which no identifier contains); pure-lowercase names are unchanged. The URL keeps the real name; only
// the on-disk file uses this key.
export const symbolFileKey = (name: string): string => {
  const lower = name.toLowerCase();
  if (lower === name) return name;
  const upper = [...name].flatMap((c, i) => (c !== c.toLowerCase() ? [i] : []));
  return `${lower}-${upper.join("-")}`;
};
