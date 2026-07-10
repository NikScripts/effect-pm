// Content source — Vite's module graph, NOT node:fs.
//
// `import.meta.glob(... ?raw)` inlines every `.dj` file as a raw string and, crucially,
// makes each one a module dependency. Editing a `.dj` therefore triggers Vite HMR and the
// page re-renders on the phone with no restart and no filesystem access. This is the
// mechanism that satisfies the "auto hot reload + no fs" requirement.

const modules = import.meta.glob("/content/**/*.dj", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export interface RawChapter {
  readonly slug: string;
  readonly group: string; // "" for top-level, e.g. "standards"
  readonly path: string;
  readonly raw: string;
}

const toEntry = (path: string, raw: string): RawChapter => {
  // "/content/standards/queues.dj" -> group "standards", slug "queues"
  const rel = path.replace(/^\/content\//, "").replace(/\.dj$/, "");
  const parts = rel.split("/");
  const slug = parts[parts.length - 1] ?? rel;
  const group = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
  return { slug, group, path, raw };
};

export const chapters: ReadonlyArray<RawChapter> = Object.entries(modules)
  .map(([path, raw]) => toEntry(path, raw))
  .sort((a, b) => a.path.localeCompare(b.path));

export const chapterBySlug = (slug: string): RawChapter | undefined =>
  chapters.find((c) => c.slug === slug);
