import { chapters, chapterBySlug } from "../../lib/content.js";
import { renderChapter } from "../../lib/docs-content.js";

// One route for every standards chapter. Server component: parse + render through
// the Effect pipeline, SSG'd at build.
export default async function ChapterPage({ chapter }: { chapter: string }) {
  const c = chapterBySlug(chapter);
  if (!c) return <p>Chapter not found: {chapter}</p>;
  const { element, meta } = await renderChapter(c.raw);
  return (
    <>
      <title>{`${meta.title} — effect-pm`}</title>
      {element}
    </>
  );
}

// Dynamic in dev (edits re-render, any slug resolves); static SSG per chapter in build.
export const getConfig = async () =>
  import.meta.env.DEV
    ? ({ render: "dynamic" } as const)
    : ({
        render: "static",
        staticPaths: chapters.filter((c) => c.group === "standards").map((c) => c.slug),
      } as const);
