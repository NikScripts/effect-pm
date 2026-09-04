/**
 * The URL and on-disk naming scheme the docgen defines — a module entry's URL slug and a symbol's
 * case-insensitively-unique data-file key. Pure string transforms; the reader side must agree, so this
 * is the one canonical copy (the site's `lib/api-slugs` re-exports it).
 *
 * @since 1.0.0
 */

/**
 * A module entry → its URL slug. `(top-level)` → `top-level`; `storage/sqlite` → `storage-sqlite`.
 *
 * @category slugs
 * @since 1.0.0
 */
export const slugForEntry = (entry: string): string =>
  entry === "(top-level)" ? "top-level" : entry.replace(/\//g, "-");

/**
 * An export name → its on-disk data-file key. Names can differ only by case (a type `Foo` and a value
 * `foo` in one module); on a case-insensitive filesystem `Foo.json` and `foo.json` are the SAME file,
 * so one clobbers the other. Lowercase the name + append the uppercase-letter positions (joined by `-`,
 * which no identifier contains); pure-lowercase names are unchanged. The URL keeps the real name; only
 * the on-disk file uses this key.
 *
 * @category slugs
 * @since 1.0.0
 */
export const symbolFileKey = (name: string): string => {
  const lower = name.toLowerCase();
  if (lower === name) return name;
  const upper = [...name].flatMap((c, i) => (c !== c.toLowerCase() ? [i] : []));
  return `${lower}-${upper.join("-")}`;
};
