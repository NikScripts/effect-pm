// Content source — Vite's module graph, NOT node:fs.
//
// `import.meta.glob(... ?raw)` inlines every `.md` file as a raw string and, crucially,
// makes each one a module dependency. Editing content therefore triggers Vite HMR and the
// page re-renders on the phone with no restart and no filesystem access. This is the
// mechanism that satisfies the "auto hot reload + no fs" requirement.

// Content lives at the docs/ root (a sibling of this app), so the reading paths reach
// up out of the Vite root (docs/site). `legacy/` and `handoffs/` are never globbed, so
// they're ignored. Requires `server.fs.allow` to include the parent (see waku.config.ts).
const modules = import.meta.glob(
  ["../../../index.md", "../../../standards/**/*.md", "../../../guides/**/*.md"],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

export interface RawChapter {
  readonly slug: string;
  readonly group: string; // "" for top-level, e.g. "standards"
  readonly path: string;
  readonly raw: string;
}

const toEntry = (path: string, raw: string): RawChapter => {
  // key is either absolute (".../docs/guides/queues.md") or relative ("../../../guides/queues.md");
  // normalize to "guides/queues" -> group "guides", slug "queues" (top-level -> group "").
  const rel = (path.includes("/docs/")
    ? path.slice(path.lastIndexOf("/docs/") + "/docs/".length)
    : path.replace(/^(?:\.\.\/)+/, "")
  ).replace(/\.md$/, "");
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
